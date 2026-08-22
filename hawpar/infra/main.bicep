// =============================================================================
// VGC Corporation — AI Document Intelligence Platform
// Cost-optimised, managed-identity-first Azure deployment.
//
//   az group create --name rg-vgc-docai --location southeastasia
//   az deployment group create \
//     --resource-group rg-vgc-docai \
//     --template-file infra/main.bicep \
//     --parameters infra/main.parameters.json
// =============================================================================

targetScope = 'resourceGroup'

@description('Short workload name used to derive resource names.')
@minLength(3)
@maxLength(12)
param workloadName string = 'vgcdocai'

@description('Deployment environment.')
@allowed(['dev', 'uat', 'prod'])
param environmentName string = 'prod'

@description('Azure region for all resources. Document Intelligence must be available in this region.')
param location string = resourceGroup().location

@description('App Service plan SKU. P1v3 matches the signed-off S$1,690/month reference profile; B1/B2/P0v3 are cheaper dev/test options.')
@allowed(['B1', 'B2', 'P0v3', 'P1v3', 'P2v3'])
param appServicePlanSku string = 'P1v3'

@description('Instances in the App Service plan. The application keeps its document index and processing queue in-process, so it must run on exactly one instance; scaling out serves stale or missing documents from the extra instances. The reference profile costs two instances for a future shared-state architecture.')
@minValue(1)
@maxValue(1)
param appServicePlanCapacity int = 1

@description('Document Intelligence SKU. S0 is pay-as-you-go; F0 gives 500 free pages per month.')
@allowed(['F0', 'S0'])
param documentIntelligenceSku string = 'S0'

@description('Days to retain platform logs in Log Analytics.')
@minValue(30)
@maxValue(730)
param logRetentionDays int = 30

@description('Confidence below which an extracted field is routed to human review.')
param reviewConfidenceThreshold string = '0.80'

var suffix = uniqueString(resourceGroup().id, workloadName, environmentName)
var namePrefix = '${workloadName}-${environmentName}'
var tags = {
  workload: 'vgc-ai-document-intelligence'
  environment: environmentName
  costCentre: 'group-shared-services'
  dataClassification: 'confidential'
}

// ── Observability ────────────────────────────────────────────────────────────

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'log-${namePrefix}'
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: logRetentionDays
    features: { enableLogAccessUsingOnlyResourcePermissions: true }
    publicNetworkAccessForIngestion: 'Enabled'
    publicNetworkAccessForQuery: 'Enabled'
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: 'appi-${namePrefix}'
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
    IngestionMode: 'LogAnalytics'
    publicNetworkAccessForIngestion: 'Enabled'
    publicNetworkAccessForQuery: 'Enabled'
  }
}

// ── Storage for original documents ───────────────────────────────────────────

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: 'st${workloadName}${take(suffix, 8)}'
  location: location
  tags: tags
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    accessTier: 'Hot'
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    networkAcls: { defaultAction: 'Allow', bypass: 'AzureServices' }
    encryption: {
      keySource: 'Microsoft.Storage'
      services: {
        blob: { enabled: true }
        file: { enabled: true }
      }
    }
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: {
    deleteRetentionPolicy: { enabled: true, days: 14 }
    containerDeleteRetentionPolicy: { enabled: true, days: 14 }
  }
}

resource documentsContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'documents'
  properties: { publicAccess: 'None' }
}

// Cost control: originals move to cool storage after 30 days and archive at 180.
resource lifecycle 'Microsoft.Storage/storageAccounts/managementPolicies@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: {
    policy: {
      rules: [
        {
          name: 'tier-processed-originals'
          enabled: true
          type: 'Lifecycle'
          definition: {
            filters: { blobTypes: ['blockBlob'], prefixMatch: ['documents/'] }
            actions: {
              baseBlob: {
                tierToCool: { daysAfterModificationGreaterThan: 30 }
                tierToArchive: { daysAfterModificationGreaterThan: 180 }
              }
            }
          }
        }
      ]
    }
  }
}

// ── Azure AI Document Intelligence ───────────────────────────────────────────

resource documentIntelligence 'Microsoft.CognitiveServices/accounts@2024-10-01' = {
  name: 'di-${namePrefix}-${take(suffix, 6)}'
  location: location
  tags: tags
  kind: 'FormRecognizer'
  sku: { name: documentIntelligenceSku }
  identity: { type: 'SystemAssigned' }
  properties: {
    customSubDomainName: 'di-${namePrefix}-${take(suffix, 6)}'
    publicNetworkAccess: 'Enabled'
    disableLocalAuth: true
    networkAcls: { defaultAction: 'Allow' }
  }
}

// ── Compute ──────────────────────────────────────────────────────────────────

resource appServicePlan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: 'plan-${namePrefix}'
  location: location
  tags: tags
  sku: {
    name: appServicePlanSku
    capacity: appServicePlanCapacity
  }
  kind: 'linux'
  properties: { reserved: true }
}

resource webApp 'Microsoft.Web/sites@2023-12-01' = {
  name: 'app-${namePrefix}-${take(suffix, 6)}'
  location: location
  tags: tags
  kind: 'app,linux'
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: appServicePlan.id
    httpsOnly: true
    clientAffinityEnabled: false
    siteConfig: {
      linuxFxVersion: 'NODE|20-lts'
      alwaysOn: appServicePlanSku != 'F1'
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      http20Enabled: true
      healthCheckPath: '/api/health'
      appCommandLine: 'node src/server.js'
      requestTracingEnabled: false
      appSettings: [
        { name: 'NODE_ENV', value: 'production' }
        { name: 'WEBSITE_NODE_DEFAULT_VERSION', value: '~20' }
        { name: 'SCM_DO_BUILD_DURING_DEPLOYMENT', value: 'true' }
        { name: 'PORT', value: '8080' }
        { name: 'LOG_LEVEL', value: 'info' }
        { name: 'ANALYZER_MODE', value: 'azure' }
        { name: 'AZURE_DOCINT_ENDPOINT', value: documentIntelligence.properties.endpoint }
        { name: 'AZURE_DOCINT_USE_MANAGED_IDENTITY', value: 'true' }
        { name: 'AZURE_DOCINT_API_VERSION', value: '2024-11-30' }
        { name: 'MAX_UPLOAD_MB', value: '100' }
        { name: 'MAX_PAGES_PER_DOCUMENT', value: '2000' }
        { name: 'PIPELINE_CONCURRENCY', value: '3' }
        { name: 'REVIEW_CONFIDENCE_THRESHOLD', value: reviewConfidenceThreshold }
        { name: 'DATA_DIR', value: '/home/data' }
        { name: 'AZURE_STORAGE_ACCOUNT', value: storage.name }
        { name: 'AZURE_STORAGE_CONTAINER', value: documentsContainer.name }
        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsights.properties.ConnectionString }
        { name: 'ApplicationInsightsAgent_EXTENSION_VERSION', value: '~3' }
      ]
    }
  }
}

resource webAppLogs 'Microsoft.Web/sites/config@2023-12-01' = {
  parent: webApp
  name: 'logs'
  properties: {
    httpLogs: {
      fileSystem: { enabled: true, retentionInMb: 35, retentionInDays: 7 }
    }
    detailedErrorMessages: { enabled: false }
    failedRequestsTracing: { enabled: false }
  }
}

// ── Secrets ──────────────────────────────────────────────────────────────────

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: 'kv-${workloadName}-${take(suffix, 8)}'
  location: location
  tags: tags
  properties: {
    tenantId: subscription().tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    enablePurgeProtection: true
    publicNetworkAccess: 'Enabled'
    networkAcls: { defaultAction: 'Allow', bypass: 'AzureServices' }
  }
}

// ── Role assignments (managed identity, no keys anywhere) ────────────────────

var cognitiveServicesUserRoleId = 'a97b65f3-24c7-4388-baec-2e87135dc908'
var storageBlobDataContributorRoleId = 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
var keyVaultSecretsUserRoleId = '4633458b-17de-408a-b874-0445c86b69e6'
var monitoringMetricsPublisherRoleId = '3913510d-42f4-4e42-8a64-420c390055eb'

resource documentIntelligenceRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: documentIntelligence
  name: guid(documentIntelligence.id, webApp.id, cognitiveServicesUserRoleId)
  properties: {
    principalId: webApp.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', cognitiveServicesUserRoleId)
  }
}

resource storageRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: storage
  name: guid(storage.id, webApp.id, storageBlobDataContributorRoleId)
  properties: {
    principalId: webApp.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', storageBlobDataContributorRoleId)
  }
}

resource keyVaultRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: keyVault
  name: guid(keyVault.id, webApp.id, keyVaultSecretsUserRoleId)
  properties: {
    principalId: webApp.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', keyVaultSecretsUserRoleId)
  }
}

resource metricsRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: appInsights
  name: guid(appInsights.id, webApp.id, monitoringMetricsPublisherRoleId)
  properties: {
    principalId: webApp.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', monitoringMetricsPublisherRoleId)
  }
}

// ── Operational alerting ─────────────────────────────────────────────────────

resource availabilityAlert 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: 'alert-${namePrefix}-http5xx'
  location: 'global'
  tags: tags
  properties: {
    description: 'Raises when the VGC document platform returns server errors.'
    severity: 2
    enabled: true
    scopes: [webApp.id]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          name: 'Http5xx'
          metricName: 'Http5xx'
          metricNamespace: 'Microsoft.Web/sites'
          operator: 'GreaterThan'
          threshold: 5
          timeAggregation: 'Total'
          criterionType: 'StaticThresholdCriterion'
        }
      ]
    }
  }
}

// ── Outputs ──────────────────────────────────────────────────────────────────

output webAppName string = webApp.name
output webAppUrl string = 'https://${webApp.properties.defaultHostName}'
output documentIntelligenceEndpoint string = documentIntelligence.properties.endpoint
output storageAccountName string = storage.name
output keyVaultName string = keyVault.name
output applicationInsightsName string = appInsights.name
output principalId string = webApp.identity.principalId

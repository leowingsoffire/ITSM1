# ITSM1

IT Service Management project.

## Getting Started

1. Clone the repository
2. Install dependencies for your language/framework
3. Run tests

## CI/CD

This project uses GitHub Actions for CI/CD:

- **CI** (`.github/workflows/ci.yml`): Runs on every push and PR to `main` — lint, test, build, security scan
- **CD** (`.github/workflows/cd.yml`): Runs on version tags (`v*`) — builds and deploys release artifacts

## Branching Strategy

| Branch | Purpose |
|--------|---------|
| `main` | Production-ready, always deployable |
| `feature/{ticket}-{desc}` | Short-lived feature branches |
| `fix/{ticket}-{desc}` | Bug fixes |
| `hotfix/{ticket}-{desc}` | Emergency production fixes |

## Commit Convention

Uses [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(scope): add new feature
fix(scope): fix a bug
docs(scope): update documentation
chore(scope): maintenance tasks
```

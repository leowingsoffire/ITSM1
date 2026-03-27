# ITSM1

IT Service Management platform built with Node.js, React, and PostgreSQL.

## Architecture

| Component | Technology |
|-----------|-----------|
| Backend API | Node.js + Express + TypeScript |
| Frontend | React + TypeScript (Vite) |
| Database | PostgreSQL + Prisma ORM |
| Auth | JWT + bcrypt |
| Containers | Docker + docker-compose |

## Project Structure

```
├── src/
│   ├── api/          # Express REST API
│   │   └── src/
│   │       ├── config/       # Environment, logging
│   │       ├── middleware/    # Auth, error handling, logging
│   │       ├── models/       # Prisma client
│   │       ├── routes/       # API routes
│   │       ├── services/     # Business logic
│   │       └── types/        # Zod schemas & TypeScript types
│   └── web/          # React frontend (Vite)
│       └── src/
│           ├── api/          # Axios client
│           ├── components/   # Shared components
│           └── pages/        # Page components
├── prisma/           # Database schema & migrations
├── docker-compose.yml
└── .github/workflows/  # CI/CD pipelines
```

## Getting Started

### Prerequisites
- Node.js 20+
- Docker & docker-compose (for PostgreSQL)

### Quick Start (Docker)
```bash
docker-compose up -d
```
This starts PostgreSQL, the API server, and the web frontend.

### Local Development

1. **Start the database:**
   ```bash
   docker-compose up db -d
   ```

2. **Set up the API:**
   ```bash
   cd src/api
   cp .env.example .env
   npm install
   npx prisma migrate dev
   npm run dev
   ```

3. **Set up the frontend:**
   ```bash
   cd src/web
   npm install
   npm run dev
   ```

4. Open http://localhost:5173

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/health` | Health check |
| POST | `/api/v1/auth/register` | Register user |
| POST | `/api/v1/auth/login` | Login (returns JWT) |
| GET | `/api/v1/incidents` | List incidents |
| GET | `/api/v1/incidents/:id` | Get incident |
| POST | `/api/v1/incidents` | Create incident |
| PATCH | `/api/v1/incidents/:id` | Update incident |

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

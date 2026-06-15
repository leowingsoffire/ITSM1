# 🤖 ThidaAI Platform

AI-powered insurance agent platform for AIA Myanmar — built with FastAPI, React, PostgreSQL, OpenAI, and Twilio.

> **Thida Soe** | thidasoe@aia.com.mm | +95 9 4318 1662 | AIA Myanmar | [www.aia.com.mm](https://www.aia.com.mm)

## ✨ Features

| Feature | Description |
|---------|-------------|
| 👥 Client Management | Store and manage client profiles |
| 🧠 AI Needs Analysis | OpenAI-powered insurance needs analysis |
| 📄 Proposal Generation | Auto-generate insurance proposals with PDF export |
| 🏆 MDRT Progress Tracking | Track Million Dollar Round Table targets |
| 🏖️ Retirement Planning | Retirement gap calculator |
| 🎓 Education Planning | Education cost projector |
| 💰 Tax Planning | Tax savings calculator |
| 📱 WhatsApp Bot | Twilio-powered WhatsApp integration |

## 🏗️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend API | Python 3.10+ · FastAPI · SQLAlchemy |
| Frontend | React · Vite · Tailwind CSS · React Router |
| Database | PostgreSQL 14+ |
| AI | OpenAI API |
| Messaging | Twilio (WhatsApp) |
| PDF | fpdf2 |

## 📁 Project Structure

```
├── backend/                # FastAPI backend
│   ├── main.py             # App entry point + CORS
│   ├── requirements.txt    # Python dependencies
│   ├── routers/            # API route handlers
│   │   ├── clients.py      # Client management + AI analysis
│   │   ├── proposals.py    # Proposal + PDF generation
│   │   ├── mdrt.py         # MDRT progress tracking
│   │   ├── planning.py     # Financial planning calculators
│   │   └── whatsapp.py     # WhatsApp webhook
│   └── models/
│       ├── database.py     # SQLAlchemy connection
│       └── schemas.py      # Pydantic models
├── frontend/               # Vite + React frontend
│   └── src/
│       ├── App.jsx         # Router setup
│       └── pages/          # Dashboard, Clients, Proposals, MDRT, Planning
├── database/
│   └── schema.sql          # PostgreSQL schema
├── docs/
│   └── SETUP.md            # Full setup guide
└── .env.example            # Environment template
```

## 🚀 Getting Started

See **[docs/SETUP.md](docs/SETUP.md)** for the full setup guide.

### Quick Start

```bash
# 1. Configure environment
cp .env.example .env
# Edit .env with your API keys

# 2. Database
psql -U postgres -f database/schema.sql

# 3. Backend
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# 4. Frontend
cd frontend
npm install && npm run dev
```

- API: http://localhost:8000 · Docs: http://localhost:8000/docs
- Frontend: http://localhost:5173

## 📡 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/clients` | List all clients |
| POST | `/api/clients/analyze` | AI needs analysis |
| POST | `/api/proposals/generate` | Generate proposal + PDF |
| POST | `/api/mdrt/progress` | Calculate MDRT progress |
| POST | `/api/planning/retirement` | Retirement gap calculator |
| POST | `/api/planning/education` | Education cost projector |
| POST | `/api/planning/tax` | Tax savings calculator |
| POST | `/api/whatsapp/webhook` | WhatsApp webhook |

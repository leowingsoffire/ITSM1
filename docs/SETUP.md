# 🛠️ ThidaAI Platform — Setup Guide

## Prerequisites
- Python 3.10+
- Node.js 18+
- PostgreSQL 14+
- OpenAI API Key
- Twilio Account (for WhatsApp)

## 1. Clone & Configure

```bash
git clone https://github.com/leowingsoffire/ITSM1.git
cd ITSM1
cp .env.example .env
# Edit .env with your API keys
```

## 2. Database Setup

```bash
psql -U postgres
\i database/schema.sql
```

## 3. Backend Setup

```bash
cd backend
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

✅ API runs at: http://localhost:8000
📖 API Docs at: http://localhost:8000/docs

## 4. Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

✅ Frontend runs at: http://localhost:5173

## 5. WhatsApp Bot Setup

1. Create Twilio account at twilio.com
2. Enable WhatsApp Sandbox
3. Add credentials to `.env`
4. Set webhook URL to: `https://YOUR_DOMAIN/api/whatsapp/webhook`

## 6. API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET  | /api/clients | List all clients |
| POST | /api/clients/analyze | AI needs analysis |
| POST | /api/proposals/generate | Generate proposal + PDF |
| POST | /api/mdrt/progress | Calculate MDRT progress |
| POST | /api/planning/retirement | Retirement gap calculator |
| POST | /api/planning/education | Education cost projector |
| POST | /api/planning/tax | Tax savings calculator |

---

**Thida Soe** | thidasoe@aia.com.mm | +95 9 4318 1662
AIA Myanmar | www.aia.com.mm

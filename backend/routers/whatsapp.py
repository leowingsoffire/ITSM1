from fastapi import APIRouter, Request

router = APIRouter(tags=["whatsapp"])


@router.post("/whatsapp/webhook")
async def whatsapp_webhook(request: Request):
    """Handle incoming WhatsApp messages via Twilio webhook."""
    body = await request.form()
    return {"message": "TODO: handle WhatsApp message", "received": dict(body)}

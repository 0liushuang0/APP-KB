from fastapi import APIRouter, Security

from app.core.auth import verify_api_key

router = APIRouter(dependencies=[Security(verify_api_key)])


@router.get("/")
async def health_check():
    return {"status": "ok", "service": "ai-service"}

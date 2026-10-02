import secrets
from fastapi import HTTPException, Security, status
from fastapi.security import APIKeyHeader
from app.core.config import get_settings

api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


async def verify_api_key(api_key: str = Security(api_key_header)):
    # 用 get_settings() 动态读取，配置热更新后鉴权立即生效（原先固化模块级 settings）。
    # 用 secrets.compare_digest 做常量时间比较，避免时序侧信道。
    expected = get_settings().api_key
    if not api_key or not secrets.compare_digest(api_key, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing API Key",
        )
    return api_key

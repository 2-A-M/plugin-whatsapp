"""WhatsApp Cloud API client."""

import logging
from typing import Any

import httpx

from elizaos_plugin_whatsapp.config import WhatsAppConfig
from elizaos_plugin_whatsapp.types import (
    LocationContent,
    MediaContent,
    MessageType,
    ReactionContent,
    TemplateContent,
    TextContent,
    WhatsAppInteractiveContent,
    WhatsAppMessage,
    WhatsAppMessageResponse,
)

logger = logging.getLogger(__name__)


class WhatsAppClientError(RuntimeError):
    """Raised when a WhatsApp API request fails."""


class WhatsAppClient:
    """Client for WhatsApp Cloud API."""

    def __init__(self, config: WhatsAppConfig):
        """Initializes the client."""
        self.config = config
        self._client = httpx.AsyncClient(
            headers={
                "Authorization": f"Bearer {config.access_token}",
                "Content-Type": "application/json",
            },
            timeout=30.0,
        )

    async def close(self) -> None:
        """Closes the HTTP client."""
        await self._client.aclose()

    async def send_message(self, message: WhatsAppMessage) -> WhatsAppMessageResponse:
        """Sends a message."""
        url = f"{self.config.api_base_url}/{self.config.phone_number_id}/messages"
        payload = self._build_message_payload(message)

        logger.debug("Sending WhatsApp message to %s", message.to)

        response = await self._client.post(url, json=payload)

        if not response.is_success:
            raise WhatsAppClientError(f"WhatsApp API error ({response.status_code}): {response.text}")

        data = response.json()
        result = WhatsAppMessageResponse(**data)

        logger.info(
            "Message sent successfully: %s",
            result.messages[0].id if result.messages else "unknown",
        )

        return result

    async def send_text(self, to: str, text: str) -> WhatsAppMessageResponse:
        """Sends a text message."""
        message = WhatsAppMessage(
            to=to,
            type=MessageType.TEXT,
            content=TextContent(body=text),
        )
        return await self.send_message(message)

    async def send_text_message(self, to: str, text: str) -> WhatsAppMessageResponse:
        """Compatibility wrapper for legacy callers."""
        return await self.send_text(to, text)

    async def send_image(
        self,
        to: str,
        media_id: str | None = None,
        link: str | None = None,
        caption: str | None = None,
    ) -> WhatsAppMessageResponse:
        """Sends an image message."""
        message = WhatsAppMessage(
            to=to,
            type=MessageType.IMAGE,
            content=MediaContent(id=media_id, link=link, caption=caption),
        )
        return await self.send_message(message)

    async def send_video(
        self,
        to: str,
        video_url: str,
        caption: str | None = None,
    ) -> WhatsAppMessageResponse:
        """Sends a video message."""
        message = WhatsAppMessage(
            to=to,
            type=MessageType.VIDEO,
            content=MediaContent(link=video_url, caption=caption),
        )
        return await self.send_message(message)

    async def send_document(
        self,
        to: str,
        document_url: str,
        filename: str | None = None,
        caption: str | None = None,
    ) -> WhatsAppMessageResponse:
        """Sends a document message."""
        message = WhatsAppMessage(
            to=to,
            type=MessageType.DOCUMENT,
            content=MediaContent(link=document_url, caption=caption, filename=filename),
        )
        return await self.send_message(message)

    async def send_location(
        self,
        to: str,
        latitude: float,
        longitude: float,
        name: str | None = None,
        address: str | None = None,
    ) -> WhatsAppMessageResponse:
        """Sends a location message."""
        message = WhatsAppMessage(
            to=to,
            type=MessageType.LOCATION,
            content=LocationContent(
                latitude=latitude,
                longitude=longitude,
                name=name,
                address=address,
            ),
        )
        return await self.send_message(message)

    async def send_reaction(self, to: str, message_id: str, emoji: str) -> WhatsAppMessageResponse:
        """Sends a reaction."""
        message = WhatsAppMessage(
            to=to,
            type=MessageType.REACTION,
            content=ReactionContent(message_id=message_id, emoji=emoji),
        )
        return await self.send_message(message)

    def verify_webhook(self, token: str) -> bool:
        """Verifies a webhook token."""
        if self.config.webhook_verify_token is None:
            return False
        return token == self.config.webhook_verify_token

    def _build_message_payload(self, message: WhatsAppMessage) -> dict[str, Any]:
        """Builds the message payload."""
        payload: dict[str, Any] = {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": message.to,
            "type": message.type.value,
        }

        if isinstance(message.content, TextContent):
            payload["text"] = {"body": message.content.body}
        elif isinstance(message.content, MediaContent):
            media_type = message.type.value
            media: dict[str, Any] = {}
            if message.content.id:
                media["id"] = message.content.id
            if message.content.link:
                media["link"] = message.content.link
            if message.content.caption:
                media["caption"] = message.content.caption
            payload[media_type] = media
        elif isinstance(message.content, TemplateContent):
            payload["template"] = {
                "name": message.content.name,
                "language": {"code": message.content.language.code},
                "components": [c.model_dump() for c in message.content.components],
            }
        elif isinstance(message.content, WhatsAppInteractiveContent):
            payload["interactive"] = message.content.model_dump(exclude_none=True)
        elif isinstance(message.content, LocationContent):
            loc: dict[str, Any] = {
                "latitude": message.content.latitude,
                "longitude": message.content.longitude,
            }
            if message.content.name:
                loc["name"] = message.content.name
            if message.content.address:
                loc["address"] = message.content.address
            payload["location"] = loc
        elif isinstance(message.content, ReactionContent):
            payload["reaction"] = {
                "message_id": message.content.message_id,
                "emoji": message.content.emoji,
            }

        return payload

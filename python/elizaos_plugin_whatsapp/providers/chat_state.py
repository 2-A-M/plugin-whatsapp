"""Chat state provider for WhatsApp."""

import logging
from datetime import datetime
from typing import Any

from elizaos.types import Memory, Provider, ProviderResult, State

from elizaos_plugin_whatsapp.types import WhatsAppChatState

logger = logging.getLogger(__name__)

WHATSAPP_SERVICE_NAME = "whatsapp"


async def get_chat_state(
    runtime: Any,
    message: Memory,
    state: State,
) -> ProviderResult:
    """Gets the chat state for WhatsApp."""
    service = runtime.get_service(WHATSAPP_SERVICE_NAME)

    if not service or not service.is_running:
        return ProviderResult(text="", values={}, data={})

    try:
        room = await runtime.get_room(message.room_id)
        if not room or not room.channel_id:
            return ProviderResult(text="", values={}, data={})

        if room.source != "whatsapp":
            return ProviderResult(text="", values={}, data={})

        chat_state = service.get_chat_state(room.channel_id)
        if not chat_state:
            return ProviderResult(text="", values={}, data={})

        text = _format_chat_state(chat_state)
        return ProviderResult(
            text=text,
            values={"chatState": text},
            data={
                "contactWaId": chat_state.contact_wa_id,
                "phoneNumberId": chat_state.phone_number_id,
            },
        )

    except Exception as e:
        logger.debug("Failed to get WhatsApp chat state: %s", e)
        return ProviderResult(text="", values={}, data={})


def _format_chat_state(state: WhatsAppChatState) -> str:
    """Formats the chat state for inclusion in prompts."""
    lines = [
        "# WhatsApp Chat Context",
        "",
        f"- Contact: {state.contact_wa_id}",
    ]

    if state.contact_name:
        lines.append(f"- Name: {state.contact_name}")

    if state.last_message_at:
        dt = datetime.fromtimestamp(state.last_message_at)
        lines.append(f"- Last Message: {dt.strftime('%Y-%m-%d %H:%M:%S')}")

    lines.append("")
    lines.append("Note: This conversation is on WhatsApp. Be helpful and concise.")

    return "\n".join(lines)


chat_state_provider = Provider(
    name="WHATSAPP_CHAT_STATE",
    description="Provides information about the current WhatsApp chat context",
    get=get_chat_state,
)

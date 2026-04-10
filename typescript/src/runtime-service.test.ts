import {
  ChannelType,
  type Content,
  type IAgentRuntime,
  type Memory,
} from "@elizaos/core";
import { describe, expect, it, vi } from "vitest";
import { WHATSAPP_TEXT_CHUNK_LIMIT } from "./normalize";
import { WhatsAppConnectorService } from "./runtime-service";
import type { WhatsAppWebhookEvent } from "./types";

function createRuntimeMock(): IAgentRuntime {
  return {
    agentId: "agent-1",
    getSetting: vi.fn(() => null),
    ensureConnection: vi.fn(async () => {}),
    createMemory: vi.fn(async () => {}),
    logger: {
      warn: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    },
    messageService: {
      handleMessage: vi.fn(),
    },
  } as unknown as IAgentRuntime;
}

function getHandleMessageMock(runtime: IAgentRuntime) {
  const messageService = runtime.messageService;
  if (!messageService) {
    throw new Error("Expected runtime.messageService mock to be present");
  }
  return vi.mocked(messageService.handleMessage);
}

describe("WhatsAppConnectorService", () => {
  it("routes webhook messages through messageService and returns whatsapp response memories", async () => {
    const runtime = createRuntimeMock();
    const service = new WhatsAppConnectorService(runtime);
    const sendMessage = vi.fn().mockResolvedValue({
      data: {
        messaging_product: "whatsapp",
        contacts: [{ input: "+14155550100", wa_id: "14155550100" }],
        messages: [{ id: "wamid.out.1" }],
      },
    });

    (
      service as unknown as {
        config: Record<string, unknown>;
        client: Record<string, unknown>;
      }
    ).config = {
      transport: "cloudapi",
      accessToken: "test-token",
      phoneNumberId: "1234567890",
    };
    (service as unknown as { client: Record<string, unknown> }).client = {
      sendMessage,
      stop: vi.fn(),
      on: vi.fn(),
    };

    let inboundMemory: Memory | null = null;
    let outboundMemories: Memory[] = [];

    getHandleMessageMock(runtime).mockImplementation(
      async (
        _runtime: IAgentRuntime,
        message: Memory,
        callback: (content: Content) => Promise<Memory[]>,
      ) => {
        inboundMemory = message;
        outboundMemories = await callback({
          text: "Reply from agent",
        });
        return {
          didRespond: true,
          responseContent: { text: "Reply from agent" },
          responseMessages: outboundMemories,
          state: { values: {}, data: {}, text: "" },
          mode: "simple",
        };
      },
    );

    const event: WhatsAppWebhookEvent = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "entry-1",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: {
                  display_phone_number: "+14155550999",
                  phone_number_id: "1234567890",
                },
                messages: [
                  {
                    from: "14155550100",
                    id: "wamid.in.1",
                    timestamp: "1710000000",
                    text: {
                      body: "hello from whatsapp",
                    },
                    type: "text",
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    await service.handleWebhook(event);

    expect(runtime.ensureConnection).toHaveBeenCalledTimes(1);
    expect(getHandleMessageMock(runtime)).toHaveBeenCalledTimes(1);
    expect(inboundMemory?.content.source).toBe("whatsapp");
    expect(inboundMemory?.content.channelType).toBe(ChannelType.DM);
    expect(inboundMemory?.content.text).toBe("hello from whatsapp");
    expect(inboundMemory?.content.from).toBe("+14155550100");
    expect(sendMessage).toHaveBeenCalledWith({
      type: "text",
      to: "+14155550100",
      content: "Reply from agent",
      replyToMessageId: "wamid.in.1",
    });
    expect(outboundMemories).toHaveLength(1);
    expect(outboundMemories[0]?.content.source).toBe("whatsapp");
    expect(outboundMemories[0]?.content.text).toBe("Reply from agent");
    expect(outboundMemories[0]?.content.inReplyTo).toBe(inboundMemory?.id);
    expect(service.phoneNumber).toBe("+14155550999");
  });

  it("uses the participant id for group messages from the paired client", async () => {
    const runtime = createRuntimeMock();
    const service = new WhatsAppConnectorService(runtime);

    (
      service as unknown as {
        config: Record<string, unknown>;
        client: Record<string, unknown>;
      }
    ).config = {
      transport: "baileys",
      authDir: "/tmp/whatsapp-auth",
      groupPolicy: "open",
    };
    (service as unknown as { client: Record<string, unknown> }).client = {
      sendMessage: vi.fn().mockResolvedValue({
        messaging_product: "whatsapp",
        contacts: [{ input: "12345@g.us", wa_id: "12345@g.us" }],
        messages: [{ id: "baileys-out-1" }],
      }),
      stop: vi.fn(),
      on: vi.fn(),
    };

    let inboundMemory: Memory | null = null;
    getHandleMessageMock(runtime).mockImplementation(
      async (
        _runtime: IAgentRuntime,
        message: Memory,
        callback: (content: Content) => Promise<Memory[]>,
      ) => {
        inboundMemory = message;
        await callback({ text: "group reply" });
        return {
          didRespond: true,
          responseContent: { text: "group reply" },
          responseMessages: [],
          state: { values: {}, data: {}, text: "" },
          mode: "simple",
        };
      },
    );

    await (
      service as unknown as {
        handleUnifiedMessage(message: {
          id: string;
          from: string;
          chatId: string;
          senderId: string;
          timestamp: number;
          type: "text";
          content: string;
        }): Promise<void>;
      }
    ).handleUnifiedMessage({
      id: "baileys-in-1",
      from: "12345@g.us",
      chatId: "12345@g.us",
      senderId: "14155550100@s.whatsapp.net",
      timestamp: 1710000000,
      type: "text",
      content: "hello group",
    });

    expect(runtime.ensureConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: "12345@g.us",
        source: "whatsapp",
        type: ChannelType.GROUP,
      }),
    );
    expect(inboundMemory?.content.from).toBe("+14155550100");
    expect(inboundMemory?.content.channelType).toBe(ChannelType.GROUP);
  });

  it("ignores webhook messages that do not produce text content", async () => {
    const runtime = createRuntimeMock();
    const service = new WhatsAppConnectorService(runtime);

    (
      service as unknown as {
        config: Record<string, unknown>;
        client: Record<string, unknown>;
      }
    ).config = {
      transport: "cloudapi",
      accessToken: "test-token",
      phoneNumberId: "1234567890",
    };
    (service as unknown as { client: Record<string, unknown> }).client = {
      sendMessage: vi.fn(),
      stop: vi.fn(),
      on: vi.fn(),
    };

    const event: WhatsAppWebhookEvent = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "entry-1",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: {
                  display_phone_number: "+14155550999",
                  phone_number_id: "1234567890",
                },
                messages: [
                  {
                    from: "14155550100",
                    id: "wamid.in.1",
                    timestamp: "1710000000",
                    type: "image",
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    await service.handleWebhook(event);

    expect(runtime.ensureConnection).not.toHaveBeenCalled();
    expect(getHandleMessageMock(runtime)).not.toHaveBeenCalled();
  });

  it("blocks inbound DMs when the policy is disabled", async () => {
    const runtime = createRuntimeMock();
    const service = new WhatsAppConnectorService(runtime);
    const sendMessage = vi.fn();

    (
      service as unknown as {
        config: Record<string, unknown>;
        client: Record<string, unknown>;
      }
    ).config = {
      transport: "cloudapi",
      accessToken: "test-token",
      phoneNumberId: "1234567890",
      dmPolicy: "disabled",
    };
    (service as unknown as { client: Record<string, unknown> }).client = {
      sendMessage,
      stop: vi.fn(),
      on: vi.fn(),
    };

    await service.handleWebhook({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "entry-1",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: {
                  display_phone_number: "+14155550999",
                  phone_number_id: "1234567890",
                },
                messages: [
                  {
                    from: "14155550100",
                    id: "wamid.in.1",
                    timestamp: "1710000000",
                    text: {
                      body: "hello from whatsapp",
                    },
                    type: "text",
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    expect(runtime.ensureConnection).not.toHaveBeenCalled();
    expect(getHandleMessageMock(runtime)).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("chunks long replies into multiple outbound WhatsApp messages", async () => {
    const runtime = createRuntimeMock();
    const service = new WhatsAppConnectorService(runtime);
    const sendMessage = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          messaging_product: "whatsapp",
          contacts: [{ input: "+14155550100", wa_id: "14155550100" }],
          messages: [{ id: "wamid.out.1" }],
        },
      })
      .mockResolvedValueOnce({
        data: {
          messaging_product: "whatsapp",
          contacts: [{ input: "+14155550100", wa_id: "14155550100" }],
          messages: [{ id: "wamid.out.2" }],
        },
      });

    (
      service as unknown as {
        config: Record<string, unknown>;
        client: Record<string, unknown>;
      }
    ).config = {
      transport: "cloudapi",
      accessToken: "test-token",
      phoneNumberId: "1234567890",
    };
    (service as unknown as { client: Record<string, unknown> }).client = {
      sendMessage,
      stop: vi.fn(),
      on: vi.fn(),
    };

    const longReply = `${"a".repeat(WHATSAPP_TEXT_CHUNK_LIMIT)} ${"b".repeat(32)}`;
    let outboundMemories: Memory[] = [];

    getHandleMessageMock(runtime).mockImplementation(
      async (
        _runtime: IAgentRuntime,
        _message: Memory,
        callback: (content: Content) => Promise<Memory[]>,
      ) => {
        outboundMemories = await callback({ text: longReply });
        return {
          didRespond: true,
          responseContent: { text: longReply },
          responseMessages: outboundMemories,
          state: { values: {}, data: {}, text: "" },
          mode: "simple",
        };
      },
    );

    await service.handleWebhook({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "entry-1",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: {
                  display_phone_number: "+14155550999",
                  phone_number_id: "1234567890",
                },
                messages: [
                  {
                    from: "14155550100",
                    id: "wamid.in.1",
                    timestamp: "1710000000",
                    text: {
                      body: "hello from whatsapp",
                    },
                    type: "text",
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(outboundMemories).toHaveLength(2);
    expect(outboundMemories[0]?.content.text.length).toBeLessThanOrEqual(
      WHATSAPP_TEXT_CHUNK_LIMIT,
    );
    expect(outboundMemories[1]?.content.text.length).toBeGreaterThan(0);
    expect(
      `${String(outboundMemories[0]?.content.text)} ${String(outboundMemories[1]?.content.text)}`.replace(
        /\s+/g,
        " ",
      ),
    ).toBe(longReply);
  });
});

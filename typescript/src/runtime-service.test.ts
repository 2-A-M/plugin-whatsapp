import { ChannelType, type Content, type IAgentRuntime, type Memory } from "@elizaos/core";
import { describe, expect, it, vi } from "vitest";
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

    (service as unknown as {
      config: Record<string, unknown>;
      client: Record<string, unknown>;
    }).config = {
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

    vi.mocked(runtime.messageService!.handleMessage).mockImplementation(
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
    expect(vi.mocked(runtime.messageService!.handleMessage)).toHaveBeenCalledTimes(1);
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

    (service as unknown as {
      config: Record<string, unknown>;
      client: Record<string, unknown>;
    }).config = {
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
    vi.mocked(runtime.messageService!.handleMessage).mockImplementation(
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

    await (service as unknown as {
      handleUnifiedMessage(message: {
        id: string;
        from: string;
        chatId: string;
        senderId: string;
        timestamp: number;
        type: "text";
        content: string;
      }): Promise<void>;
    }).handleUnifiedMessage({
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
});

import { useState, useRef, useEffect } from "react";
import { useStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Bot, Send, Loader2, X } from "lucide-react";
import type { ChatMessage } from "@/types";

export function AssistantPanel() {
  const assistantOpen = useStore((s) => s.assistantOpen);
  const setAssistantOpen = useStore((s) => s.setAssistantOpen);
  const chatMessages = useStore((s) => s.chatMessages);
  const addChatMessage = useStore((s) => s.addChatMessage);
  const isChatting = useStore((s) => s.isChatting);
  const setIsChatting = useStore((s) => s.setIsChatting);
  const prompt = useStore((s) => s.prompt);

  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatMessages]);

  if (!assistantOpen) return null;

  const handleSend = async () => {
    if (!input.trim() || isChatting) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: input,
      timestamp: Date.now(),
    };
    addChatMessage(userMsg);
    setInput("");
    setIsChatting(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: input,
          context: prompt ? `Current prompt: "${prompt}"` : "",
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Unknown error" }));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }

      const data = await res.json();
      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: data.reply,
        timestamp: Date.now(),
      };
      addChatMessage(assistantMsg);
    } catch (e) {
      const errorMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: `Error: ${e instanceof Error ? e.message : "Chat failed"}`,
        timestamp: Date.now(),
      };
      addChatMessage(errorMsg);
    } finally {
      setIsChatting(false);
    }
  };

  return (
    <div className="flex h-full w-full flex-col border-l border-border bg-card">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">AI Assistant</span>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setAssistantOpen(false)}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 px-3 py-2" ref={scrollRef}>
        <div className="space-y-3">
          {chatMessages.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <Bot className="h-10 w-10 mx-auto mb-2 opacity-40" />
              <p className="text-sm">Ask for prompt suggestions, 3D tips, or help with the app.</p>
            </div>
          )}
          {chatMessages.map((msg) => (
            <div
              key={msg.id}
              className={msg.role === "user" ? "text-right" : "text-left"}
            >
              <div
                className={
                  msg.role === "user"
                    ? "inline-block max-w-[85%] rounded-lg bg-primary px-3 py-1.5 text-sm text-primary-foreground"
                    : "inline-block max-w-[85%] rounded-lg bg-muted px-3 py-1.5 text-sm text-foreground"
                }
              >
                {msg.content}
              </div>
            </div>
          ))}
          {isChatting && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Thinking…</span>
            </div>
          )}
        </div>
      </ScrollArea>

      <Separator />

      {/* Input */}
      <div className="flex gap-2 p-3">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          placeholder="Ask the assistant…"
          disabled={isChatting}
          className="flex-1"
        />
        <Button size="icon" onClick={handleSend} disabled={!input.trim() || isChatting}>
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

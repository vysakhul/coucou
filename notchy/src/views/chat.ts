// The chat view: Coucou's PromptView look (card with an indigo wash, Mochi on
// the left, scrolling log, input bar). Quick-action chips prefill the input.
// Understanding the instructions arrives in a later milestone; for now the
// assistant only acknowledges them.

import { h, svg, ICONS } from "./dom";

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
}

export interface ChatHost {
  /** The conversation changed length: the island resizes to it. */
  onHeightChange(): void;
  /** A message was sent; resolves with the reply. */
  send(text: string): Promise<string>;
  /** Typing or clicking in the chat counts as activity. */
  activity(): void;
  /** Escape in the field. */
  close(): void;
}

const CHIPS: { label: string; prefill: string }[] = [
  { label: "⏰ Set an alarm", prefill: "Set an alarm for " },
  { label: "🔔 Remind me", prefill: "Remind me to " },
  { label: "📋 Upcoming", prefill: "What's coming up?" },
];

export class ChatView {
  readonly el: HTMLElement;
  readonly messages: ChatMessage[] = [];

  private log: HTMLElement;
  private input: HTMLInputElement;
  private busy = false;
  private typingRow: HTMLElement | null = null;

  constructor(private host: ChatHost) {
    const chips = h(
      "div",
      { class: "chip-row" },
      ...CHIPS.map((c) =>
        h("button", {
          class: "chip settled",
          onclick: () => {
            this.input.value = c.prefill;
            this.focus();
            this.host.activity();
          },
        }, c.label),
      ),
    );
    this.log = h("div", { class: "chat-log" });
    this.input = h("input", {
      class: "chat-input",
      type: "text",
      placeholder: "Ask me to set an alarm or a reminder…",
      spellcheck: "false",
    });
    this.input.addEventListener("keydown", (e) => {
      this.host.activity();
      if (e.key === "Enter") {
        e.preventDefault();
        void this.submit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        this.host.close();
      }
    });
    this.input.addEventListener("input", () => this.host.activity());
    const send = h("button", { class: "send-btn", title: "Send", onclick: () => void this.submit() },
      svg(ICONS.arrowUp, 15, { stroke: 2.2 }));
    const bar = h("div", { class: "chat-bar" }, this.input, send);
    const body = h("div", { class: "chat-body" }, chips, this.log, bar);
    this.el = h("div", { class: "view chat" },
      h("div", { class: "card wash chat-card", style: "--wash: rgba(99,102,241,.5)" }, body));
  }

  focus() {
    this.input.focus();
    const end = this.input.value.length;
    this.input.setSelectionRange(end, end);
  }

  private async submit() {
    const text = this.input.value.trim();
    if (!text || this.busy) return;
    this.busy = true;
    this.input.value = "";
    this.push({ role: "user", text });
    this.showTyping(true);
    try {
      const reply = await this.host.send(text);
      this.showTyping(false);
      this.push({ role: "assistant", text: reply });
    } finally {
      this.showTyping(false);
      this.busy = false;
      this.focus();
    }
  }

  private push(m: ChatMessage) {
    this.messages.push(m);
    const row = m.role === "user"
      ? h("div", { class: "chat-row user" }, h("div", { class: "bubble", text: m.text }))
      : h("div", { class: "chat-row" }, h("div", { class: "reply" }, h("div", { class: "md-p", text: m.text })));
    this.log.append(row);
    this.log.scrollTop = this.log.scrollHeight;
    this.host.onHeightChange();
  }

  private showTyping(on: boolean) {
    if (on && !this.typingRow) {
      this.typingRow = h("div", { class: "chat-row" }, h("div", { class: "typing" }, h("i"), h("i"), h("i")));
      this.log.append(this.typingRow);
      this.log.scrollTop = this.log.scrollHeight;
    } else if (!on && this.typingRow) {
      this.typingRow.remove();
      this.typingRow = null;
    }
  }
}

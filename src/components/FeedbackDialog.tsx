import { useState } from "react";
import type { Language } from "../types";
import { MAX_FEEDBACK_LENGTH, submitFeedback } from "../lib/feedback";
import { message, type MessageKey } from "../lib/i18n";
import { Modal } from "./Modal";

interface Props {
  language: Language;
  onClose: () => void;
  onSuccess: () => void;
}

export function FeedbackDialog({ language, onClose, onSuccess }: Props) {
  const t = (key: MessageKey, values?: Record<string, string | number>) => message(language, key, values);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);

  function close() {
    if (!sending) onClose();
  }

  async function send() {
    if (!text.trim() || sending) return;
    setSending(true);
    setFailed(false);
    try {
      await submitFeedback(text, language);
      onSuccess();
    } catch {
      setFailed(true);
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal
      title={t("feedbackTitle")}
      closeLabel={t("close")}
      onClose={close}
      footer={(
        <>
          <button type="button" onClick={close} disabled={sending}>{t("cancel")}</button>
          <button type="button" className="primary" onClick={() => void send()} disabled={sending || !text.trim()}>
            {sending ? t("sending") : t("send")}
          </button>
        </>
      )}
    >
      <div className="feedback-form">
        <p>{t("feedbackHint")}</p>
        <textarea
          rows={5}
          maxLength={MAX_FEEDBACK_LENGTH}
          value={text}
          placeholder={t("feedbackPlaceholder")}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void send();
          }}
        />
        <div className="feedback-meta">
          <span className={failed ? "feedback-error" : undefined}>{failed ? t("feedbackFailure") : ""}</span>
          <span>{t("feedbackCounter", { count: text.length, max: MAX_FEEDBACK_LENGTH })}</span>
        </div>
      </div>
    </Modal>
  );
}

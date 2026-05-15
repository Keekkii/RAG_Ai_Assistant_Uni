import { useState, useRef, useEffect } from "react";
import "./FullChat.css";
import { supabase } from "./supabaseClient";

function FullChat({ onClose, sessionStart }) {
    const [messages, setMessages] = useState([]);
    const [question, setQuestion] = useState("");
    const [loading, setLoading] = useState(false);
    const chatEndRef = useRef(null);
    const textareaRef = useRef(null);

    const saveToHistory = async (role, content) => {
        try {
            const { data: { session } } = await supabase.auth.getSession();
            const token = session?.access_token;
            await fetch("http://127.0.0.1:8000/history", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${token}`
                },
                body: JSON.stringify({ role, content })
            });
        } catch (error) {
            console.error("Failed to save to history:", error);
        }
    };

    const askQuestion = async () => {
        if (!question.trim() || loading) return;

        const userMessage = { role: "user", content: question };
        setMessages((prev) => [...prev, userMessage]);
        setQuestion("");
        setLoading(true);

        // Add empty placeholder for the AI response
        setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

        try {
            const { data: { session } } = await supabase.auth.getSession();
            const token = session?.access_token;

            const response = await fetch("http://127.0.0.1:8000/chat/stream", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${token}`
                },
                body: JSON.stringify({ question: userMessage.content, session_start: sessionStart })
            });

            if (!response.ok) throw new Error(`HTTP error: ${response.status}`);

            const reader = response.body.getReader();
            const decoder = new TextDecoder("utf-8");
            let buffer = "";
            let fullAnswer = "";

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const events = buffer.split("\n\n");
                buffer = events.pop(); // keep any incomplete trailing event

                for (const event of events) {
                    if (!event.trim()) continue;
                    const lines = event.split("\n");
                    for (const line of lines) {
                        if (!line.startsWith("data: ")) continue;
                        const payload = line.slice(6);

                        if (payload === "[DONE]") {
                            setLoading(false);
                            saveToHistory("user", userMessage.content);
                            saveToHistory("assistant", fullAnswer);
                            return;
                        }
                        if (payload.startsWith("[ERROR]")) {
                            throw new Error(payload.slice(8));
                        }
                        const tokenText = payload.replace(/\\n/g, "\n");
                        fullAnswer += tokenText;
                        setMessages((prev) => {
                            const updated = [...prev];
                            updated[updated.length - 1] = { role: "assistant", content: fullAnswer };
                            return updated;
                        });
                    }
                }
            }
        } catch (error) {
            setMessages((prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = { role: "assistant", content: "Sorry, I'm having trouble connecting to the server. Please check if the backend is running." };
                return updated;
            });
        } finally {
            setLoading(false);
        }
    };

    const handleKeyDown = (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            askQuestion();
        }
    };

    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages, loading]);

    // Auto-resize textarea
    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = "auto";
            textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
        }
    }, [question]);

    return (
        <div className="full-chat-overlay">
            <div className="full-chat-container">
                <header className="full-chat-header">
                    <div className="header-left">
                        <img src="/logo_a.png" alt="Logo" className="header-logo" />
                        <div className="header-info">
                            <h1>AlphaWave AI Assistant</h1>
                            <span className="header-tagline">Secure • Private • Intelligence</span>
                        </div>
                    </div>
                    <button className="full-chat-close" onClick={onClose} aria-label="Close full UI">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                    </button>
                </header>

                <main className="full-chat-messages">
                    <div className="messages-inner">
                        {messages.length === 0 && (
                            <div className="full-message ai-full">
                                Hello! I'm AlphaWave AI. How can I assist you today?
                            </div>
                        )}

                        {messages.map((msg, index) => {
                            if (loading && index === messages.length - 1 && msg.role === "assistant" && msg.content === "") return null;
                            return (
                                <div
                                    key={index}
                                    className={`full-message ${msg.role === "user" ? "user-full" : "ai-full"}`}
                                >
                                    {msg.content}
                                </div>
                            );
                        })}

                        {loading && messages[messages.length - 1]?.content === "" && (
                            <div className="full-message ai-full full-typing">
                                <div className="full-dot"></div>
                                <div className="full-dot"></div>
                                <div className="full-dot"></div>
                            </div>
                        )}

                        <div ref={chatEndRef} />
                    </div>
                </main>

                <footer className="full-chat-input-area">
                    <div className="full-input-wrapper">
                        <textarea
                            ref={textareaRef}
                            value={question}
                            onChange={(e) => setQuestion(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="Type your message..."
                            className="full-textarea"
                            rows={1}
                            disabled={loading}
                        />
                        <button
                            onClick={askQuestion}
                            className="full-send-btn"
                            disabled={!question.trim() || loading}
                        >
                            <svg
                                viewBox="0 0 24 24"
                                width="20"
                                height="20"
                                stroke="currentColor"
                                strokeWidth="2.5"
                                fill="none"
                            >
                                <line x1="22" y1="2" x2="11" y2="13"></line>
                                <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                            </svg>
                        </button>
                    </div>
                </footer>
            </div>
        </div>
    );
}

export default FullChat;

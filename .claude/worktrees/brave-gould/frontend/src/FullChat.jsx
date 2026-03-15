import { useState, useRef, useEffect } from "react";
import "./FullChat.css";
import { supabase } from "./supabaseClient";

function FullChat({ onClose }) {
    const [messages, setMessages] = useState([]);
    const [question, setQuestion] = useState("");
    const [loading, setLoading] = useState(false);
    const [loadingHistory, setLoadingHistory] = useState(false);
    const chatEndRef = useRef(null);
    const textareaRef = useRef(null);

    const fetchHistory = async () => {
        setLoadingHistory(true);
        try {
            const { data: { session } } = await supabase.auth.getSession();
            const token = session?.access_token;
            if (!token) return;

            const response = await fetch("http://127.0.0.1:8000/history", {
                headers: { "Authorization": `Bearer ${token}` }
            });
            const data = await response.json();
            if (response.ok && Array.isArray(data)) {
                setMessages(data);
            } else {
                console.warn("Invalid history format or error", data);
                setMessages([]);
            }
        } catch (error) {
            console.error("Failed to fetch history:", error);
        } finally {
            setLoadingHistory(false);
        }
    };

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

    useEffect(() => {
        fetchHistory();
    }, []);

    const askQuestion = async () => {
        if (!question.trim() || loading) return;

        const userMessage = { role: "user", content: question };
        setMessages((prev) => [...prev, userMessage]);
        setQuestion("");
        setLoading(true);

        try {
            const { data: { session } } = await supabase.auth.getSession();
            const token = session?.access_token;

            // Save user msg to DB
            saveToHistory("user", userMessage.content);

            const response = await fetch("http://127.0.0.1:8000/chat", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${token}`
                },
                body: JSON.stringify({ question })
            });

            const data = await response.json();
            const aiMessage = { role: "assistant", content: data.answer };
            setMessages((prev) => [...prev, aiMessage]);

            // Save AI msg to DB
            saveToHistory("assistant", aiMessage.content);
        } catch (error) {
            setMessages((prev) => [
                ...prev,
                { role: "assistant", content: "Sorry, I'm having trouble connecting to the server. Please check if the backend is running." }
            ]);
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
                        {loadingHistory && (
                            <div className="full-chat-loading">Restoring your conversation...</div>
                        )}

                        {!loadingHistory && messages.length === 0 && (
                            <div className="full-message ai-full">
                                Hello! I'm AlphaWave AI. How can I assist you today?
                            </div>
                        )}

                        {messages.map((msg, index) => (
                            <div
                                key={index}
                                className={`full-message ${msg.role === "user" ? "user-full" : "ai-full"}`}
                            >
                                {msg.content}
                            </div>
                        ))}

                        {loading && (
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

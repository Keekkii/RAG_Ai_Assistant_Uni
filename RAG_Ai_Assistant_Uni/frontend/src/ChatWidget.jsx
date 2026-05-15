import React, { useState, useEffect, useRef } from 'react';
import './ChatWidget.css';
import { supabase } from "./supabaseClient";

const ChatWidget = ({ onExpand, sessionStart }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState([]);
    const [inputValue, setInputValue] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const messagesEndRef = useRef(null);
    const textareaRef = useRef(null);

    const saveToHistory = async (role, content) => {
        try {
            const { data: { session } } = await supabase.auth.getSession();
            const token = session?.access_token;
            await fetch(`http://127.0.0.1:8000/history`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ role, content })
            });
        } catch (error) {
            console.error('Failed to save to history:', error);
        }
    };

    // Auto-scroll to bottom
    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages, isLoading]);

    // Handle textarea height
    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
        }
    }, [inputValue]);

    const toggleChat = () => setIsOpen(!isOpen);

    const handleSendMessage = async (e) => {
        if (e) e.preventDefault();
        if (!inputValue.trim() || isLoading) return;

        const userMsg = { role: 'user', content: inputValue.trim() };
        setMessages((prev) => [...prev, userMsg]);
        setInputValue('');
        setIsLoading(true);

        // Add empty placeholder for the AI response that will be filled token-by-token
        setMessages((prev) => [...prev, { role: 'assistant', content: '' }]);

        try {
            const { data: { session } } = await supabase.auth.getSession();
            const token = session?.access_token;

            const response = await fetch('http://127.0.0.1:8000/chat/stream', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ question: userMsg.content, session_start: sessionStart }),
            });

            if (!response.ok) throw new Error(`HTTP error: ${response.status}`);

            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let buffer = '';
            let fullAnswer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const events = buffer.split('\n\n');
                buffer = events.pop(); // keep any incomplete trailing event

                for (const event of events) {
                    if (!event.trim()) continue;
                    const lines = event.split('\n');
                    for (const line of lines) {
                        if (!line.startsWith('data: ')) continue;
                        const payload = line.slice(6);

                        if (payload === '[DONE]') {
                            setIsLoading(false);
                            saveToHistory('user', userMsg.content);
                            saveToHistory('assistant', fullAnswer);
                            return;
                        }
                        if (payload.startsWith('[ERROR]')) {
                            throw new Error(payload.slice(8));
                        }
                        const token = payload.replace(/\\n/g, '\n');
                        fullAnswer += token;
                        setMessages((prev) => {
                            const updated = [...prev];
                            updated[updated.length - 1] = { role: 'assistant', content: fullAnswer };
                            return updated;
                        });
                    }
                }
            }
        } catch (error) {
            console.error('Error sending message:', error);
            setMessages((prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = { role: 'assistant', content: 'Connection error. Please try again later.' };
                return updated;
            });
        } finally {
            setIsLoading(false);
        }
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    };

    return (
        <div className="chat-widget-wrapper">
            {/* Floating Button */}
            {!isOpen && (
                <button className="chat-trigger" onClick={toggleChat} aria-label="Open AI Assistant">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    AI Assistant
                </button>
            )}

            {/* Popup Window */}
            {isOpen && (
                <div className="chat-popup">
                    {/* Header */}
                    <div className="chat-header">
                        <div className="header-title">
                            <span className="status-dot"></span>
                            <h3>AlphaWave AI</h3>
                        </div>
                        <div className="header-actions">
                            <button className="expand-btn" onClick={onExpand} title="Full Screen View" aria-label="Full Screen">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                    <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                            </button>
                            <button className="close-btn" onClick={toggleChat} aria-label="Close Chat">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                            </button>
                        </div>
                    </div>

                    {/* Chat Area */}
                    <div className="chat-messages">
                        {messages.length === 0 && (
                            <div className="message ai">
                                Hello! I'm your AlphaWave assistant. How can I help you today?
                            </div>
                        )}

                        {messages.map((msg, index) => {
                            if (isLoading && index === messages.length - 1 && msg.role === 'assistant' && msg.content === '') return null;
                            return (
                                <div key={index} className={`message ${msg.role === 'user' ? 'user' : 'ai'}`}>
                                    {msg.content}
                                </div>
                            );
                        })}

                        {isLoading && messages[messages.length - 1]?.content === '' && (
                            <div className="message ai">
                                <div className="typing-indicator">
                                    <div className="dot"></div>
                                    <div className="dot"></div>
                                    <div className="dot"></div>
                                </div>
                            </div>
                        )}
                        <div ref={messagesEndRef} />
                    </div>

                    {/* Input Area */}
                    <div className="chat-input-area">
                        <div className="input-container">
                            <textarea
                                ref={textareaRef}
                                placeholder="Message..."
                                value={inputValue}
                                onChange={(e) => setInputValue(e.target.value)}
                                onKeyDown={handleKeyDown}
                                rows={1}
                                disabled={isLoading}
                            />
                            <button
                                className="send-btn"
                                onClick={handleSendMessage}
                                disabled={!inputValue.trim() || isLoading}
                            >
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M22 2L11 13M22 2L15 22L11 13L2 9L22 2z" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ChatWidget;

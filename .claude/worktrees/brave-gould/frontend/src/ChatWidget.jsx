import React, { useState, useEffect, useRef } from 'react';
import './ChatWidget.css';
import { supabase } from "./supabaseClient";

const ChatWidget = ({ onExpand }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState([]);
    const [inputValue, setInputValue] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const [isFetchingHistory, setIsFetchingHistory] = useState(false);

    const messagesEndRef = useRef(null);
    const textareaRef = useRef(null);

    // Fetch history from backend
    const fetchHistory = async () => {
        setIsFetchingHistory(true);
        try {
            const { data: { session } } = await supabase.auth.getSession();
            const token = session?.access_token;
            if (!token) return;

            const response = await fetch('http://127.0.0.1:8000/history', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await response.json();
            if (response.ok && Array.isArray(data)) {
                setMessages(data);
            } else {
                console.error('History API error:', data);
                setMessages([]);
            }
        } catch (error) {
            console.error('Failed to fetch history:', error);
        } finally {
            setIsFetchingHistory(false);
        }
    };

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

    useEffect(() => {
        fetchHistory();
    }, []);

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

        try {
            const { data: { session } } = await supabase.auth.getSession();
            const token = session?.access_token;

            // Save user message to DB
            saveToHistory('user', userMsg.content);

            const response = await fetch('http://127.0.0.1:8000/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ question: userMsg.content }),
            });

            if (!response.ok) throw new Error('Network response was not ok');

            const data = await response.json();
            const aiMsg = { role: 'assistant', content: data.answer };
            setMessages((prev) => [...prev, aiMsg]);

            // Save AI message to DB
            saveToHistory('assistant', aiMsg.content);
        } catch (error) {
            console.error('Error sending message:', error);
            setMessages((prev) => [
                ...prev,
                { role: 'assistant', content: 'Connection error. Please try again later.' }
            ]);
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

                        {messages.map((msg, index) => (
                            <div key={index} className={`message ${msg.role === 'user' ? 'user' : 'ai'}`}>
                                {msg.content}
                            </div>
                        ))}

                        {isLoading && (
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

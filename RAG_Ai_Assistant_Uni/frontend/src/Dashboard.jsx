import { useState, useEffect } from "react";
import "./Dashboard.css";
import { supabase } from "./supabaseClient";

function groupByUser(logs) {
    const userMap = {};
    logs.forEach(log => {
        const userKey = log.user_email || "anonymous";
        const sessionKey = log.session_start || "legacy";

        if (!userMap[userKey]) {
            userMap[userKey] = {
                user_name: log.user_name || "Guest",
                user_email: log.user_email || "Anonymous",
                sessions: {},
            };
        }
        if (!userMap[userKey].sessions[sessionKey]) {
            userMap[userKey].sessions[sessionKey] = {
                session_start: log.session_start,
                logs: [],
            };
        }
        userMap[userKey].sessions[sessionKey].logs.push(log);
    });

    return Object.values(userMap).map(user => ({
        ...user,
        sessions: Object.values(user.sessions),
    }));
}

function SessionGroup({ session, onSelectLog }) {
    const [expanded, setExpanded] = useState(false);

    const avgLatency = Math.round(
        session.logs.reduce((sum, l) => sum + l.latency_ms, 0) / session.logs.length
    );
    const sessionLabel = session.session_start
        ? new Date(session.session_start).toLocaleString()
        : "Earlier sessions";

    return (
        <div className="session-group">
            <div className="session-header" onClick={() => setExpanded(!expanded)}>
                <div className="session-header-left">
                    <span className="session-chevron">{expanded ? "▼" : "▶"}</span>
                    <div>
                        <span className="session-user">{session.user_name}</span>
                        <span className="session-time">{sessionLabel}</span>
                    </div>
                </div>
                <div className="session-header-right">
                    <span className="session-badge">{session.logs.length} {session.logs.length === 1 ? "query" : "queries"}</span>
                    <span className={`session-latency ${avgLatency > 2000 ? "slow" : "fast"}`}>
                        avg {avgLatency}ms
                    </span>
                </div>
            </div>

            {expanded && (
                <table className="log-table">
                    <thead>
                        <tr>
                            <th>Time</th>
                            <th>Query</th>
                            <th>Latency</th>
                            <th>Top Chunk</th>
                            <th>RRF Score</th>
                        </tr>
                    </thead>
                    <tbody>
                        {session.logs.map((log, idx) => (
                            <tr key={idx} onClick={() => onSelectLog(log)} className="log-row">
                                <td data-label="Time">{new Date(log.timestamp).toLocaleTimeString()}</td>
                                <td data-label="Query" className="query-cell">{log.query}</td>
                                <td data-label="Latency" className={`latency-cell ${log.latency_ms > 2000 ? "slow" : "fast"}`}>
                                    {Math.round(log.latency_ms)}ms
                                </td>
                                <td data-label="Top Chunk" className="chunk-cell">
                                    {log.retrieved_chunks?.[0]?.title || "N/A"}
                                </td>
                                <td data-label="Score" className="score-cell">
                                    {log.retrieved_chunks?.[0]?.rrf_score?.toFixed(4) || "0.0000"}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    );
}

function UserGroup({ user, onSelectLog }) {
    const [expanded, setExpanded] = useState(false);
    const totalQueries = user.sessions.reduce((sum, s) => sum + s.logs.length, 0);

    return (
        <div className="user-group">
            <div className="user-header" onClick={() => setExpanded(!expanded)}>
                <div className="session-header-left">
                    <span className="session-chevron">{expanded ? "▼" : "▶"}</span>
                    <div>
                        <span className="session-user">{user.user_name}</span>
                        <span className="session-time">{user.user_email}</span>
                    </div>
                </div>
                <div className="session-header-right">
                    <span className="session-badge">{totalQueries} {totalQueries === 1 ? "query" : "queries"}</span>
                    <span className="session-badge">{user.sessions.length} {user.sessions.length === 1 ? "session" : "sessions"}</span>
                </div>
            </div>
            {expanded && (
                <div className="user-sessions">
                    {user.sessions.map((session, idx) => (
                        <SessionGroup
                            key={idx}
                            session={{ ...session, user_name: user.user_name, user_email: user.user_email }}
                            onSelectLog={onSelectLog}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

function Dashboard({ onClose }) {
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedLog, setSelectedLog] = useState(null);

    const fetchLogs = async () => {
        try {
            const { data: { session } } = await supabase.auth.getSession();
            const token = session?.access_token;

            const response = await fetch("http://localhost:8000/logs", {
                headers: { "Authorization": `Bearer ${token}` }
            });
            const data = await response.json();
            setLogs(data);
        } catch (error) {
            console.error("Failed to fetch logs:", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchLogs();
        const interval = setInterval(fetchLogs, 2000);
        return () => clearInterval(interval);
    }, []);

    const users = groupByUser(logs);

    return (
        <div className="dashboard-overlay">
            <div className="dashboard-window">
                <header className="dashboard-header">
                    <div className="header-left">
                        <h2>System Analytics</h2>
                        <span className="live-indicator">LIVE</span>
                    </div>
                    <button className="dashboard-close" onClick={onClose}>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                    </button>
                </header>

                <div className="dashboard-content">
                    {loading && logs.length === 0 ? (
                        <div className="dashboard-empty">
                            <div className="loading-spinner"></div>
                            <p>Loading analytics...</p>
                        </div>
                    ) : users.length === 0 ? (
                        <div className="dashboard-empty">
                            <p>No interaction logs found yet.</p>
                        </div>
                    ) : (
                        <div className="sessions-list">
                            {users.map((user, idx) => (
                                <UserGroup
                                    key={idx}
                                    user={user}
                                    onSelectLog={setSelectedLog}
                                />
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {selectedLog && (
                <div className="detail-modal-overlay" onClick={() => setSelectedLog(null)}>
                    <div className="detail-modal-content" onClick={(e) => e.stopPropagation()}>
                        <div className="detail-modal-header">
                            <h3>Raw Log Interaction</h3>
                            <button className="detail-modal-close" onClick={() => setSelectedLog(null)}>×</button>
                        </div>
                        <div className="json-viewer">
                            <pre>{JSON.stringify(selectedLog, null, 2)}</pre>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default Dashboard;

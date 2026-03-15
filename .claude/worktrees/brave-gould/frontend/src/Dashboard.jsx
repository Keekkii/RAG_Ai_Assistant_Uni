import { useState, useEffect } from "react";
import "./Dashboard.css";
import { supabase } from "./supabaseClient";

function Dashboard({ onClose }) {
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedLog, setSelectedLog] = useState(null);

    const fetchLogs = async () => {
        try {
            const { data: { session } } = await supabase.auth.getSession();
            const token = session?.access_token;

            const response = await fetch("http://localhost:8000/logs", {
                headers: {
                    "Authorization": `Bearer ${token}`
                }
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
        const interval = setInterval(fetchLogs, 5000); // 5s refresh
        return () => clearInterval(interval);
    }, []);

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
                    ) : logs.length === 0 ? (
                        <div className="dashboard-empty">
                            <p>No interaction logs found yet.</p>
                        </div>
                    ) : (
                        <div className="log-table-container">
                            <table className="log-table">
                                <thead>
                                    <tr>
                                        <th>Timestamp</th>
                                        <th>User</th>
                                        <th>Query</th>
                                        <th>Latency</th>
                                        <th>Top Chunk</th>
                                        <th>RRF Score</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {logs.map((log, idx) => (
                                        <tr key={idx} onClick={() => setSelectedLog(log)} className="log-row">
                                            <td data-label="Timestamp">{new Date(log.timestamp).toLocaleTimeString()}</td>
                                            <td data-label="User" className="user-cell">{log.user_name || "Guest"}</td>
                                            <td data-label="Query" className="query-cell">{log.query}</td>
                                            <td data-label="Latency" className={`latency-cell ${log.latency_ms > 2000 ? 'slow' : 'fast'}`}>
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
                        </div>
                    )}
                </div>
            </div>

            {/* Custom JSON Modal */}
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

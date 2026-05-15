import React, { useState } from "react";
import { supabase } from "./supabaseClient";
import "./Auth.css";

const Auth = ({ onAuthSuccess }) => {
    const [isLogin, setIsLogin] = useState(true);
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [fullName, setFullName] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError("");
        setLoading(true);

        try {
            if (isLogin) {
                // Log In
                const { data, error: loginError } = await supabase.auth.signInWithPassword({
                    email,
                    password,
                });
                if (loginError) throw loginError;
                onAuthSuccess();
            } else {
                // Sign Up
                const { data, error: signUpError } = await supabase.auth.signUp({
                    email,
                    password,
                    options: {
                        data: {
                            full_name: fullName,
                        }
                    }
                });
                if (signUpError) throw signUpError;

                alert("Registration successful! You can now log in.");
                setIsLogin(true);
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="auth-overlay">
            <div className="auth-card">
                <div className="auth-header">
                    <img src="/logo_a.png" alt="Logo" className="auth-logo" />
                    <h2>{isLogin ? "Welcome Back" : "Create Account"}</h2>
                    <p>{isLogin ? "Login to your RAG Assistant" : "Join the AlphaWave network"}</p>
                </div>

                <form onSubmit={handleSubmit} className="auth-form">
                    {error && <div className="error-badge">{error}</div>}

                    {!isLogin && (
                        <div className="input-group">
                            <label>Full Name</label>
                            <input
                                type="text"
                                value={fullName}
                                onChange={(e) => setFullName(e.target.value)}
                                required
                                placeholder="John Doe"
                            />
                        </div>
                    )}

                    <div className="input-group">
                        <label>Email</label>
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                            placeholder="john@example.com"
                        />
                    </div>

                    <div className="input-group">
                        <label>Password</label>
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                            placeholder="••••••••"
                        />
                    </div>

                    <button type="submit" className="auth-submit" disabled={loading}>
                        {loading ? "Processing..." : isLogin ? "Login" : "Register"}
                    </button>
                </form>

                <div className="auth-footer">
                    <button onClick={() => {
                        setIsLogin(!isLogin);
                        setError("");
                    }} className="toggle-btn">
                        {isLogin ? "Need an account? Register" : "Already have an account? Login"}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default Auth;

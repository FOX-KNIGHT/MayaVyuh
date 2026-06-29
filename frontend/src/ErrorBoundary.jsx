import React from "react";

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ error, errorInfo });
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 40, background: "#222", color: "white", minHeight: "100vh" }}>
          <h1 style={{ color: "red" }}>Something went wrong.</h1>
          <pre style={{ color: "orange", whiteSpace: "pre-wrap" }}>{this.state.error && this.state.error.toString()}</pre>
          <pre style={{ color: "gray", fontSize: 12, whiteSpace: "pre-wrap" }}>{this.state.errorInfo && this.state.errorInfo.componentStack}</pre>
          <button onClick={() => { localStorage.clear(); window.location.reload(); }} style={{ padding: 10, marginTop: 20 }}>Clear Cache & Reload</button>
        </div>
      );
    }
    return this.props.children;
  }
}

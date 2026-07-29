import React from 'react';

interface LoadingProgressProps {
  progress: number; // 0-100
  message?: string;
}

const LoadingProgress: React.FC<LoadingProgressProps> = ({ progress, message = 'Uploading images...' }) => {
  return (
    <div style={{
      position: 'fixed',
      bottom: 24,
      right: 24,
      zIndex: 99999,
      background: 'var(--ink-800)',
      border: '1.5px solid var(--accent-line)',
      borderRadius: 14,
      padding: '14px 20px 14px',
      minWidth: 280,
      maxWidth: 360,
      boxShadow: 'var(--shadow-accent)',
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
      fontFamily: 'inherit',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '0.88rem' }}>{message}</span>
        {/* Was #6366f1 — 4.2:1 on this panel, under the bar at 0.88rem (~7.9px
            at the 9px root, so no large-text exemption). --accent is 6.8:1. */}
        <span style={{ color: 'var(--accent)', fontWeight: 700, fontSize: '0.88rem', flexShrink: 0 }}>
          {Math.round(progress)}%
        </span>
      </div>
      <div style={{ height: 6, background: 'var(--accent-dim)', borderRadius: 99, overflow: 'hidden' }}>
        <div style={{
          height: '100%',
          width: `${progress}%`,
          background: 'linear-gradient(90deg, var(--accent-press), var(--accent))',
          borderRadius: 99,
          transition: 'width 0.3s ease',
        }} />
      </div>
    </div>
  );
};

export default LoadingProgress;

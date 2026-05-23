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
      background: 'rgba(20, 16, 40, 0.97)',
      border: '1.5px solid #6366f1',
      borderRadius: 14,
      padding: '14px 20px 14px',
      minWidth: 280,
      maxWidth: 360,
      boxShadow: '0 8px 32px rgba(99,102,241,0.25)',
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
      fontFamily: 'inherit',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ color: '#e2e8f0', fontWeight: 600, fontSize: '0.88rem' }}>{message}</span>
        <span style={{ color: '#6366f1', fontWeight: 700, fontSize: '0.88rem', flexShrink: 0 }}>
          {Math.round(progress)}%
        </span>
      </div>
      <div style={{ height: 6, background: 'rgba(99,102,241,0.2)', borderRadius: 99, overflow: 'hidden' }}>
        <div style={{
          height: '100%',
          width: `${progress}%`,
          background: 'linear-gradient(90deg, #6366f1, #818cf8)',
          borderRadius: 99,
          transition: 'width 0.3s ease',
        }} />
      </div>
    </div>
  );
};

export default LoadingProgress;

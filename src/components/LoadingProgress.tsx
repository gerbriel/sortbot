import React from 'react';
import './LoadingProgress.css';

interface LoadingProgressProps {
  progress: number; // 0-100
  message?: string;
}

const LoadingProgress: React.FC<LoadingProgressProps> = ({ progress, message = 'Loading images...' }) => {
  return (
    <div className="loading-progress-overlay">
      <div className="loading-progress-container">
        <div className="loading-message">{message}</div>
        
        {/* Clothing Rack */}
        <div className="clothes-rack-container">
          {/* Rack base */}
          <div className="clothes-rack">
            <div className="rack-bar"></div>
            <div className="rack-stand-left"></div>
            <div className="rack-stand-right"></div>
          </div>
          
          {/* Moving Hanger */}
          <div 
            className="moving-hanger" 
            style={{ 
              left: `${progress}%`,
              transform: `translateX(-50%) ${progress > 90 ? 'scale(0.95)' : 'scale(1)'}` 
            }}
            key={`upload-hanger-${Math.round(progress)}`}
          >
            {/* Hanger hook */}
            <div className="hanger-hook"></div>
            {/* Hanger bar */}
            <div className="hanger-bar"></div>
            {/* Hanger sides */}
            <div className="hanger-left"></div>
            <div className="hanger-right"></div>
            {/* Clothing on hanger */}
            <div className="hanger-clothing"></div>
          </div>
          
          {/* Static hangers already on rack */}
          <div className="static-hangers">
            <div className="static-hanger" style={{ left: '75%', opacity: progress > 70 ? 1 : 0.3 }}>
              <div className="hanger-hook"></div>
              <div className="hanger-bar"></div>
              <div className="hanger-left"></div>
              <div className="hanger-right"></div>
              <div className="hanger-clothing static"></div>
            </div>
            <div className="static-hanger" style={{ left: '85%', opacity: progress > 80 ? 1 : 0.3 }}>
              <div className="hanger-hook"></div>
              <div className="hanger-bar"></div>
              <div className="hanger-left"></div>
              <div className="hanger-right"></div>
              <div className="hanger-clothing static"></div>
            </div>
          </div>
        </div>
        
        {/* Progress Bar */}
        <div className="progress-bar-container">
          <div className="progress-bar-bg">
            <div 
              className="progress-bar-fill" 
              style={{ width: `${progress}%` }}
            ></div>
          </div>
          <div className="progress-text">{Math.round(progress)}%</div>
        </div>
      </div>
    </div>
  );
};

export default LoadingProgress;

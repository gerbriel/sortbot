import { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import type { ClothingItem } from '../App';
import './ImageUpload.css';

interface ImageUploadProps {
  onImagesUploaded: (items: ClothingItem[]) => void;
}

const ImageUpload: React.FC<ImageUploadProps> = ({ onImagesUploaded }) => {
  const onDrop = useCallback((acceptedFiles: File[]) => {
    const items: ClothingItem[] = acceptedFiles.map(file => ({
      id: `${Date.now()}-${Math.random()}`,
      file,
      preview: URL.createObjectURL(file),
    }));
    
    onImagesUploaded(items);
  }, [onImagesUploaded]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/*': ['.jpeg', '.jpg', '.png', '.webp']
    },
    multiple: true
  });

  return (
    <div className="image-upload-container">
      <div 
        {...getRootProps()} 
        className={`dropzone ${isDragActive ? 'active' : ''}`}
      >
          <input {...getInputProps()} />
          <div className="dropzone-content">
            <svg 
              className="upload-icon" 
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <path 
                strokeLinecap="round" 
                strokeLinejoin="round" 
                strokeWidth={2} 
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" 
              />
            </svg>
            {isDragActive ? (
              <p>Drop the images here...</p>
            ) : (
              <>
                <p>Drag & drop clothing images here</p>
                <p className="dropzone-subtext">or click to select files</p>
                <p className="dropzone-hint">Supports: JPG, PNG, WEBP</p>
              </>
            )}
          </div>
        </div>
      )}

      {/* Google Drive Mode */}
      {uploadMode === 'drive' && (
        <div className="drive-upload-section">
          <div className="drive-instructions">
            <h3>📁 Load from Google Drive</h3>
            <ol>
              <li>Open your Google Drive folder with clothing images</li>
              <li>Click "Share" → Set to "Anyone with the link can view"</li>
              <li>Copy the folder URL and paste it below</li>
            </ol>
          </div>
          
          <div className="drive-input-group">
            <input
              type="text"
              className="drive-url-input"
              placeholder="Paste Google Drive folder URL here..."
              value={driveFolderUrl}
              onChange={(e) => setDriveFolderUrl(e.target.value)}
              disabled={isLoadingDrive}
            />
            <button
              className="drive-load-btn"
              onClick={fetchDriveImages}
              disabled={!driveFolderUrl.trim() || isLoadingDrive}
            >
              {isLoadingDrive ? '⏳ Loading...' : '📥 Load Images'}
            </button>
          </div>

          <div className="drive-example">
            <details>
              <summary>Example URL format</summary>
              <code>https://drive.google.com/drive/folders/1a2B3c4D5e6F7g8H9i0J</code>
            </details>
          </div>
        </div>
      )}
    </div>
  );
};

export default ImageUpload;

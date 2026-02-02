import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import type { ClothingItem } from '../App';
import './ImageUpload.css';

interface ImageUploadProps {
  onImagesUploaded: (items: ClothingItem[]) => void;
}

const ImageUpload: React.FC<ImageUploadProps> = ({ onImagesUploaded }) => {
  const [driveFolderUrl, setDriveFolderUrl] = useState('');
  const [isLoadingDrive, setIsLoadingDrive] = useState(false);
  const [uploadMode, setUploadMode] = useState<'file' | 'drive'>('file');

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const items: ClothingItem[] = acceptedFiles.map(file => ({
      id: `${Date.now()}-${Math.random()}`,
      file,
      preview: URL.createObjectURL(file),
    }));
    
    onImagesUploaded(items);
  }, [onImagesUploaded]);

  const extractFolderId = (url: string): string | null => {
    // Extract folder ID from various Google Drive URL formats
    // https://drive.google.com/drive/folders/FOLDER_ID
    // https://drive.google.com/drive/folders/FOLDER_ID?usp=sharing
    const folderMatch = url.match(/\/folders\/([a-zA-Z0-9_-]+)/);
    if (folderMatch) return folderMatch[1];
    
    // If just the ID is pasted
    if (/^[a-zA-Z0-9_-]+$/.test(url)) return url;
    
    return null;
  };

  const fetchDriveImages = async () => {
    const folderId = extractFolderId(driveFolderUrl);
    
    if (!folderId) {
      alert('❌ Invalid Google Drive folder URL. Please paste a valid folder link.');
      return;
    }

    setIsLoadingDrive(true);

    try {
      // Google Drive API endpoint to list files in folder
      // Note: This requires the folder to be publicly accessible or use OAuth
      const apiKey = import.meta.env.VITE_GOOGLE_API_KEY;
      
      if (!apiKey) {
        alert('⚠️ Google Drive API key not configured.\n\nPlease add VITE_GOOGLE_API_KEY to your .env file.\n\nFor now, you can:\n1. Make folder publicly accessible\n2. Use "Anyone with link can view"\n3. Download images manually and use file upload');
        setIsLoadingDrive(false);
        return;
      }

      // Fetch files from the folder
      const response = await fetch(
        `https://www.googleapis.com/drive/v3/files?` +
        `q='${folderId}'+in+parents+and+(mimeType+contains+'image/')&` +
        `fields=files(id,name,mimeType,thumbnailLink,webContentLink)&` +
        `key=${apiKey}`
      );

      if (!response.ok) {
        throw new Error(`API error: ${response.status} - Make sure folder is publicly accessible`);
      }

      const data = await response.json();
      
      if (!data.files || data.files.length === 0) {
        alert('📁 No images found in this folder.\n\nMake sure:\n1. The folder contains images\n2. The folder is shared with "Anyone with link can view"');
        setIsLoadingDrive(false);
        return;
      }

      // Fetch each image and convert to File objects
      const items: ClothingItem[] = [];
      
      for (const file of data.files) {
        try {
          // Download the actual image content
          const imageUrl = `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media&key=${apiKey}`;
          const imageResponse = await fetch(imageUrl);
          
          if (imageResponse.ok) {
            const blob = await imageResponse.blob();
            const fileName = file.name || `image-${file.id}.jpg`;
            const fileObj = new File([blob], fileName, { type: blob.type });
            
            items.push({
              id: `drive-${file.id}-${Date.now()}`,
              file: fileObj,
              preview: URL.createObjectURL(blob),
            });
          }
        } catch (err) {
          console.warn(`Failed to fetch image ${file.name}:`, err);
        }
      }

      if (items.length > 0) {
        onImagesUploaded(items);
        alert(`✅ Successfully loaded ${items.length} image(s) from Google Drive!`);
        setDriveFolderUrl('');
      } else {
        alert('❌ Could not load images from Drive. Make sure folder permissions are set to "Anyone with link can view".');
      }

    } catch (error) {
      alert(`❌ Error loading from Google Drive:\n\n${error instanceof Error ? error.message : 'Unknown error'}\n\nMake sure the folder is shared publicly.`);
    } finally {
      setIsLoadingDrive(false);
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/*': ['.jpeg', '.jpg', '.png', '.webp']
    },
    multiple: true
  });

  return (
    <div className="image-upload-container">
      {/* Upload Mode Toggle */}
      <div className="upload-mode-toggle">
        <button
          className={`mode-btn ${uploadMode === 'file' ? 'active' : ''}`}
          onClick={() => setUploadMode('file')}
        >
          📁 Upload Files
        </button>
        <button
          className={`mode-btn ${uploadMode === 'drive' ? 'active' : ''}`}
          onClick={() => setUploadMode('drive')}
        >
          ☁️ Google Drive Folder
        </button>
      </div>

      {/* File Upload Mode */}
      {uploadMode === 'file' && (
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

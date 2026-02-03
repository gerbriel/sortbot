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
    </div>
  );
};

export default ImageUpload;

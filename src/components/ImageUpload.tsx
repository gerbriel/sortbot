import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import type { ClothingItem } from '../App';
import { supabase } from '../lib/supabase';
import './ImageUpload.css';

interface ImageUploadProps {
  onImagesUploaded: (items: ClothingItem[]) => void;
  userId: string;
}

const ImageUpload: React.FC<ImageUploadProps> = ({ onImagesUploaded, userId }) => {
  const [isUploading, setIsUploading] = useState(false);
  
  const uploadToSupabase = async (file: File, productId: string): Promise<{ preview: string; imageUrls: string[]; storagePath: string } | null> => {
    try {
      const fileExt = file.name.split('.').pop();
      const randomId = Math.random().toString(36).substring(2, 15);
      const fileName = `${Date.now()}-${randomId}.${fileExt}`;
      // Use permanent path so the URL stored in DB remains valid indefinitely.
      const filePath = `${userId}/${productId}/${fileName}`;

      const { data, error } = await supabase.storage
        .from('product-images')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: false
        });

      if (error) {
        console.error('Upload error:', error);
        return null;
      }

      const { data: { publicUrl } } = supabase.storage
        .from('product-images')
        .getPublicUrl(data.path);

      return {
        preview: publicUrl,
        imageUrls: [publicUrl],
        storagePath: data.path
      };
    } catch (error) {
      console.error('Upload failed:', error);
      return null;
    }
  };

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return;
    console.log(`[Step1:Upload] onDrop | files=${acceptedFiles.length} | names=${acceptedFiles.map(f => f.name).join(', ')}`);

    setIsUploading(true);

    // Upload in chunks of 10 to avoid rate-limiting 100s of concurrent Supabase requests.
    // Unconstrained Promise.all on large drops causes some uploads to fail and fall back
    // to ephemeral blob URLs that break on page reload.
    const CHUNK = 10;
    const items: ClothingItem[] = [];

    for (let i = 0; i < acceptedFiles.length; i += CHUNK) {
      const chunk = acceptedFiles.slice(i, i + CHUNK);
      const results = await Promise.all(chunk.map(async (file) => {
        const productId = `${Date.now()}-${Math.random()}`;
        const uploaded = await uploadToSupabase(file, productId);
        if (!uploaded) {
          console.warn('⚠️ Upload failed for:', file.name, '- using blob URL as fallback');
          return {
            id: productId,
            file,
            preview: URL.createObjectURL(file),
          };
        }
        return {
          id: productId,
          file,
          preview: uploaded.preview,
          imageUrls: uploaded.imageUrls,
          storagePath: uploaded.storagePath,
        };
      }));
      items.push(...results);
    }

    setIsUploading(false);
    console.log(`[Step1:Upload] upload complete | success=${items.filter(i => i.storagePath).length} fallback=${items.filter(i => !i.storagePath).length} | total=${items.length}`);
    onImagesUploaded(items);
  }, [onImagesUploaded, userId]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/*': ['.jpeg', '.jpg', '.png', '.webp']
    },
    multiple: true,
    disabled: isUploading
  });

  return (
      <div className="image-upload-container">
        <div 
          {...getRootProps()} 
          className={`dropzone ${isDragActive ? 'active' : ''} ${isUploading ? 'uploading' : ''}`}
        >
          <input {...getInputProps()} />
          <div className="dropzone-content">
            {isUploading ? (
              <>
                <div className="spinner"></div>
                <p>Uploading images to Supabase...</p>
              </>
            ) : (
              <>
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
              </>
            )}
          </div>
        </div>
      </div>
  );
};

export default ImageUpload;

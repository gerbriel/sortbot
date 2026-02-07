import React, { useState, useEffect } from 'react';
import { fetchUserProducts, deleteProduct } from '../lib/productService';
import './SavedProducts.css';

interface SavedProductsProps {
  userId: string;
  onClose: () => void;
}

interface ProductWithImages {
  id: string;
  title: string;
  description: string;
  price: number;
  status: string;
  condition: string;
  size: string;
  color: string;
  created_at: string;
  batch_id?: string;
  product_images: Array<{
    id: string;
    image_url: string;
    position: number;
    alt_text: string;
  }>;
}

export const SavedProducts: React.FC<SavedProductsProps> = ({ userId, onClose }) => {
  const [products, setProducts] = useState<ProductWithImages[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'products' | 'batches'>('products');

  useEffect(() => {
    loadProducts();
  }, [userId]);

  const loadProducts = async () => {
    setLoading(true);
    const data = await fetchUserProducts(userId);
    setProducts(data as ProductWithImages[]);
    setLoading(false);
  };

  const handleDelete = async (productId: string) => {
    const success = await deleteProduct(productId, userId);
    if (success) {
      setProducts(products.filter(p => p.id !== productId));
      setDeleteConfirm(null);
    } else {
      alert('Failed to delete product. Please try again.');
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const getMainImage = (product: ProductWithImages) => {
    const sortedImages = [...product.product_images].sort((a, b) => a.position - b.position);
    return sortedImages[0]?.image_url || '';
  };

  // Group products by batch_id
  const getBatches = () => {
    const batches: Record<string, ProductWithImages[]> = {};
    products.forEach(product => {
      const batchKey = product.batch_id || 'unbatched';
      if (!batches[batchKey]) {
        batches[batchKey] = [];
      }
      batches[batchKey].push(product);
    });
    return batches;
  };

  const batches = getBatches();
  const batchEntries = Object.entries(batches).sort((a, b) => {
    // Sort by most recent first
    const dateA = new Date(a[1][0].created_at).getTime();
    const dateB = new Date(b[1][0].created_at).getTime();
    return dateB - dateA;
  });

  if (loading) {
    return (
      <div className="saved-products-modal">
        <div className="saved-products-content">
          <div className="loading-state">
            <div className="spinner"></div>
            <p>Loading your products...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="saved-products-modal" onClick={onClose}>
      <div className="saved-products-content" onClick={(e) => e.stopPropagation()}>
        <div className="saved-products-header">
          <h2>Saved Products ({products.length})</h2>
          <button className="close-button" onClick={onClose}>
            ✕
          </button>
        </div>

        {products.length === 0 ? (
          <div className="empty-state">
            <p>No saved products yet.</p>
            <p className="empty-subtitle">Products you save will appear here.</p>
          </div>
        ) : (
          <>
            {/* View Mode Toggle */}
            <div className="view-mode-toggle">
              <button
                className={`toggle-button ${viewMode === 'products' ? 'active' : ''}`}
                onClick={() => setViewMode('products')}
              >
                📦 Product Groups ({products.length})
              </button>
              <button
                className={`toggle-button ${viewMode === 'batches' ? 'active' : ''}`}
                onClick={() => setViewMode('batches')}
              >
                📁 Batch View ({batchEntries.length})
              </button>
            </div>

            {viewMode === 'products' ? (
              /* Product Groups View */
              <div className="products-grid">
                {products.map((product) => (
              <div key={product.id} className="product-card">
                {getMainImage(product) && (
                  <div className="product-image">
                    <img src={getMainImage(product)} alt={product.title} />
                    {product.product_images.length > 1 && (
                      <div className="image-count">
                        +{product.product_images.length - 1}
                      </div>
                    )}
                  </div>
                )}
                
                <div className="product-info">
                  <h3>{product.title}</h3>
                  
                  <div className="product-meta">
                    {product.size && <span className="meta-tag">{product.size}</span>}
                    {product.color && <span className="meta-tag">{product.color}</span>}
                    {product.condition && <span className="meta-tag">{product.condition}</span>}
                  </div>

                  <p className="product-description">
                    {product.description?.slice(0, 100)}
                    {product.description?.length > 100 && '...'}
                  </p>

                  <div className="product-footer">
                    <div className="product-price">
                      {product.price ? `$${product.price.toFixed(2)}` : 'No price'}
                    </div>
                    <div className="product-status">
                      <span className={`status-badge ${product.status.toLowerCase()}`}>
                        {product.status}
                      </span>
                    </div>
                  </div>

                  <div className="product-date">
                    Saved {formatDate(product.created_at)}
                  </div>

                  <div className="product-actions">
                    <a
                      href={getMainImage(product)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="action-button view-button"
                    >
                      View Images
                    </a>
                    
                    {deleteConfirm === product.id ? (
                      <div className="delete-confirm">
                        <button
                          className="action-button confirm-button"
                          onClick={() => handleDelete(product.id)}
                        >
                          Confirm Delete
                        </button>
                        <button
                          className="action-button cancel-button"
                          onClick={() => setDeleteConfirm(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        className="action-button delete-button"
                        onClick={() => setDeleteConfirm(product.id)}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
            ) : (
              /* Batch View */
              <div className="batches-container">
                {batchEntries.map(([batchId, batchProducts]) => (
                  <div key={batchId} className="batch-group">
                    <div className="batch-header">
                      <h3>
                        📁 Batch {batchId === 'unbatched' ? 'Uploaded Individually' : `from ${formatDate(batchProducts[0].created_at)}`}
                      </h3>
                      <span className="batch-count">{batchProducts.length} product group{batchProducts.length > 1 ? 's' : ''}</span>
                    </div>
                    <div className="products-grid">
                      {batchProducts.map((product) => (
                        <div key={product.id} className="product-card">
                          {getMainImage(product) && (
                            <div className="product-image">
                              <img src={getMainImage(product)} alt={product.title} />
                              {product.product_images.length > 1 && (
                                <div className="image-count">
                                  +{product.product_images.length - 1}
                                </div>
                              )}
                            </div>
                          )}
                          
                          <div className="product-info">
                            <h3>{product.title}</h3>
                            
                            <div className="product-meta">
                              {product.size && <span className="meta-tag">{product.size}</span>}
                              {product.color && <span className="meta-tag">{product.color}</span>}
                              {product.condition && <span className="meta-tag">{product.condition}</span>}
                            </div>

                            <p className="product-description">
                              {product.description?.slice(0, 100)}
                              {product.description?.length > 100 && '...'}
                            </p>

                            <div className="product-footer">
                              <div className="product-price">
                                {product.price ? `$${product.price.toFixed(2)}` : 'No price'}
                              </div>
                              <div className="product-status">
                                <span className={`status-badge ${product.status.toLowerCase()}`}>
                                  {product.status}
                                </span>
                              </div>
                            </div>

                            <div className="product-date">
                              Saved {formatDate(product.created_at)}
                            </div>

                            <div className="product-actions">
                              <a
                                href={getMainImage(product)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="action-button view-button"
                              >
                                View Images
                              </a>
                              
                              {deleteConfirm === product.id ? (
                                <div className="delete-confirm">
                                  <button
                                    className="action-button confirm-button"
                                    onClick={() => handleDelete(product.id)}
                                  >
                                    Confirm Delete
                                  </button>
                                  <button
                                    className="action-button cancel-button"
                                    onClick={() => setDeleteConfirm(null)}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              ) : (
                                <button
                                  className="action-button delete-button"
                                  onClick={() => setDeleteConfirm(product.id)}
                                >
                                  Delete
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

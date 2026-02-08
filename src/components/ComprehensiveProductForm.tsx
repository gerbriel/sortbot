import React, { useState } from 'react';
import type { ClothingItem } from '../App';
import './ComprehensiveProductForm.css';

interface ComprehensiveProductFormProps {
  currentItem: ClothingItem;
  currentGroup: ClothingItem[];
  processedItems: ClothingItem[];
  setProcessedItems: (items: ClothingItem[]) => void;
  regenerateSeoTitle: () => void;
  regenerateTags: () => void;
  regenerateSize: () => void;
}

export const ComprehensiveProductForm: React.FC<ComprehensiveProductFormProps> = ({
  currentItem,
  currentGroup,
  processedItems,
  setProcessedItems,
  regenerateSeoTitle,
  regenerateTags,
  regenerateSize,
}) => {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['basic']));

  const toggleSection = (section: string) => {
    const newExpanded = new Set(expandedSections);
    if (newExpanded.has(section)) {
      newExpanded.delete(section);
    } else {
      newExpanded.add(section);
    }
    setExpandedSections(newExpanded);
  };

  const updateGroupField = (fieldPath: string, value: any) => {
    const updated = [...processedItems];
    currentGroup.forEach(groupItem => {
      const itemIndex = updated.findIndex(item => item.id === groupItem.id);
      if (itemIndex !== -1) {
        const keys = fieldPath.split('.');
        if (keys.length === 1) {
          (updated[itemIndex] as any)[keys[0]] = value;
        } else {
          // Handle nested fields like measurements.pitToPit
          if (!updated[itemIndex][keys[0] as keyof ClothingItem]) {
            (updated[itemIndex] as any)[keys[0]] = {};
          }
          (updated[itemIndex][keys[0] as keyof ClothingItem] as any)[keys[1]] = value;
        }
      }
    });
    setProcessedItems(updated);
  };

  const isFromPreset = (fieldName: string): boolean => {
    return !!(currentItem._presetData && currentItem[fieldName as keyof ClothingItem]);
  };

  const PresetBadge = ({ show }: { show: boolean }) => {
    if (!show) return null;
    return (
      <span className="preset-badge" title={`From "${currentItem._presetData?.displayName}" preset`}>
        ← Preset
      </span>
    );
  };

  return (
    <div className="comprehensive-product-form">
      {/* Section 1: Basic Product Info */}
      <div className="form-section-collapsible">
        <div className="section-header" onClick={() => toggleSection('basic')}>
          <span className="section-icon">{expandedSections.has('basic') ? '▼' : '▶'}</span>
          <h3>💰 Basic Product Info</h3>
          <span className="field-count">(9 fields)</span>
        </div>
        {expandedSections.has('basic') && (
          <div className="section-content">
            <div className="info-item">
              <label>Price ($): <PresetBadge show={isFromPreset('price')} /></label>
              <input
                type="number"
                value={currentItem.price || ''}
                onChange={(e) => updateGroupField('price', e.target.value ? parseFloat(e.target.value) : undefined)}
                placeholder="e.g., 49.99"
                className="info-input"
                step="0.01"
                min="0"
              />
            </div>

            <div className="info-item">
              <label>Compare-at Price ($):</label>
              <input
                type="number"
                value={currentItem.compareAtPrice || ''}
                onChange={(e) => updateGroupField('compareAtPrice', e.target.value ? parseFloat(e.target.value) : undefined)}
                placeholder="Original price for sale pricing"
                className="info-input"
                step="0.01"
                min="0"
              />
            </div>

            <div className="info-item">
              <label>Cost Per Item ($):</label>
              <input
                type="number"
                value={currentItem.costPerItem || ''}
                onChange={(e) => updateGroupField('costPerItem', e.target.value ? parseFloat(e.target.value) : undefined)}
                placeholder="Your cost"
                className="info-input"
                step="0.01"
                min="0"
              />
            </div>

            <div className="info-item">
              <label>SEO Title:</label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  type="text"
                  value={currentItem.seoTitle || ''}
                  onChange={(e) => updateGroupField('seoTitle', e.target.value)}
                  placeholder="e.g., Vintage Black Rolling Stones Tee"
                  className="info-input"
                  style={{ flex: 1 }}
                />
                <button
                  className="button button-secondary"
                  onClick={regenerateSeoTitle}
                  style={{ minWidth: '100px' }}
                  title="Regenerate SEO title from voice description"
                >
                  🔄 Regen
                </button>
              </div>
            </div>

            <div className="info-item">
              <label>Tags (comma-separated): <PresetBadge show={isFromPreset('tags')} /></label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  type="text"
                  value={currentItem.tags?.join(', ') || ''}
                  onChange={(e) => updateGroupField('tags', e.target.value ? e.target.value.split(',').map(t => t.trim()).filter(t => t) : [])}
                  placeholder="e.g., vintage, tees, rock, black"
                  className="info-input"
                  style={{ flex: 1 }}
                />
                <button
                  className="button button-secondary"
                  onClick={regenerateTags}
                  style={{ minWidth: '100px' }}
                  title="Regenerate tags from voice description"
                >
                  🔄 Regen
                </button>
              </div>
            </div>

            <div className="info-item">
              <label>Brand: <PresetBadge show={isFromPreset('brand')} /></label>
              <input
                type="text"
                value={currentItem.brand || ''}
                onChange={(e) => updateGroupField('brand', e.target.value)}
                placeholder="e.g., Nike, Levi's, or 'unbranded'"
                className="info-input"
              />
            </div>

            <div className="info-item">
              <label>Condition:</label>
              <select
                value={currentItem.condition || ''}
                onChange={(e) => updateGroupField('condition', e.target.value)}
                className="info-input"
              >
                <option value="">Select condition...</option>
                <option value="New">New</option>
                <option value="NWT">NWT (New With Tags)</option>
                <option value="Excellent">Excellent</option>
                <option value="Good">Good</option>
                <option value="Fair">Fair</option>
                <option value="Used">Used</option>
              </select>
            </div>

            <div className="info-item">
              <label>Flaws (if any):</label>
              <input
                type="text"
                value={currentItem.flaws || ''}
                onChange={(e) => updateGroupField('flaws', e.target.value)}
                placeholder="e.g., minor pilling on sleeves, small stain on hem"
                className="info-input"
              />
            </div>

            <div className="info-item">
              <label>Product Type: <PresetBadge show={isFromPreset('productType')} /></label>
              <input
                type="text"
                value={currentItem.productType || ''}
                onChange={(e) => updateGroupField('productType', e.target.value)}
                placeholder="e.g., Graphic Tee, Hoodie, Jeans"
                className="info-input"
              />
            </div>
          </div>
        )}
      </div>

      {/* Section 2: Product Details */}
      <div className="form-section-collapsible">
        <div className="section-header" onClick={() => toggleSection('details')}>
          <span className="section-icon">{expandedSections.has('details') ? '▼' : '▶'}</span>
          <h3>📋 Product Details</h3>
          <span className="field-count">(13 fields)</span>
        </div>
        {expandedSections.has('details') && (
          <div className="section-content">
            <div className="info-item">
              <label>Size:</label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  type="text"
                  value={currentItem.size || ''}
                  onChange={(e) => updateGroupField('size', e.target.value)}
                  placeholder="e.g., M, L, XL, 32, 10"
                  className="info-input"
                  style={{ flex: 1 }}
                />
                <button
                  className="button button-secondary"
                  onClick={regenerateSize}
                  style={{ minWidth: '100px' }}
                  title="Detect size from voice description"
                >
                  🔄 Regen
                </button>
              </div>
            </div>

            <div className="info-item">
              <label>Color:</label>
              <input
                type="text"
                value={currentItem.color || ''}
                onChange={(e) => updateGroupField('color', e.target.value)}
                placeholder="e.g., Black, Blue, Red"
                className="info-input"
              />
            </div>

            <div className="info-item">
              <label>Secondary Color:</label>
              <input
                type="text"
                value={currentItem.secondaryColor || ''}
                onChange={(e) => updateGroupField('secondaryColor', e.target.value)}
                placeholder="Additional color"
                className="info-input"
              />
            </div>

            <div className="info-item">
              <label>Material: <PresetBadge show={isFromPreset('material')} /></label>
              <input
                type="text"
                value={currentItem.material || ''}
                onChange={(e) => updateGroupField('material', e.target.value)}
                placeholder="e.g., 100% Cotton, Polyester blend"
                className="info-input"
              />
            </div>

            <div className="info-item">
              <label>Model Name:</label>
              <input
                type="text"
                value={currentItem.modelName || ''}
                onChange={(e) => updateGroupField('modelName', e.target.value)}
                placeholder="e.g., Air Force 1, 501 Original Fit"
                className="info-input"
              />
            </div>

            <div className="info-item">
              <label>Model Number:</label>
              <input
                type="text"
                value={currentItem.modelNumber || ''}
                onChange={(e) => updateGroupField('modelNumber', e.target.value)}
                placeholder="e.g., AF1, 501, MA-1"
                className="info-input"
              />
            </div>

            <div className="info-item">
              <label>Era/Vibe:</label>
              <input
                type="text"
                value={currentItem.era || ''}
                onChange={(e) => updateGroupField('era', e.target.value)}
                placeholder="e.g., 90s, Y2K, vintage"
                className="info-input"
              />
            </div>

            <div className="info-item">
              <label>Style: <PresetBadge show={isFromPreset('style')} /></label>
              <input
                type="text"
                value={currentItem.style || ''}
                onChange={(e) => updateGroupField('style', e.target.value)}
                placeholder="e.g., Vintage, Modern, Streetwear"
                className="info-input"
              />
            </div>

            <div className="info-item">
              <label>Gender: <PresetBadge show={isFromPreset('gender')} /></label>
              <select
                value={currentItem.gender || ''}
                onChange={(e) => updateGroupField('gender', e.target.value)}
                className="info-input"
              >
                <option value="">Select gender...</option>
                <option value="Men">Men</option>
                <option value="Women">Women</option>
                <option value="Unisex">Unisex</option>
                <option value="Kids">Kids</option>
              </select>
            </div>

            <div className="info-item">
              <label>Age Group: <PresetBadge show={isFromPreset('ageGroup')} /></label>
              <input
                type="text"
                value={currentItem.ageGroup || ''}
                onChange={(e) => updateGroupField('ageGroup', e.target.value)}
                placeholder="e.g., Adult (13+ years old)"
                className="info-input"
              />
            </div>

            <div className="info-item">
              <label>Size Type: <PresetBadge show={isFromPreset('sizeType')} /></label>
              <select
                value={currentItem.sizeType || ''}
                onChange={(e) => updateGroupField('sizeType', e.target.value)}
                className="info-input"
              >
                <option value="">Select size type...</option>
                <option value="Regular">Regular</option>
                <option value="Big & Tall">Big & Tall</option>
                <option value="Petite">Petite</option>
                <option value="Plus Size">Plus Size</option>
                <option value="One Size">One Size</option>
              </select>
            </div>

            <div className="info-item">
              <label>Care Instructions: <PresetBadge show={isFromPreset('care')} /></label>
              <input
                type="text"
                value={currentItem.care || ''}
                onChange={(e) => updateGroupField('care', e.target.value)}
                placeholder="e.g., Machine wash cold"
                className="info-input"
              />
            </div>

            <div className="info-item">
              <label>SEO Description:</label>
              <textarea
                value={currentItem.seoDescription || ''}
                onChange={(e) => updateGroupField('seoDescription', e.target.value)}
                placeholder="Meta description for search engines"
                className="info-input"
                rows={3}
              />
            </div>
          </div>
        )}
      </div>

      {/* Section 3: Measurements */}
      <div className="form-section-collapsible">
        <div className="section-header" onClick={() => toggleSection('measurements')}>
          <span className="section-icon">{expandedSections.has('measurements') ? '▼' : '▶'}</span>
          <h3>📏 Measurements</h3>
          <span className="field-count">(7 fields)</span>
        </div>
        {expandedSections.has('measurements') && (
          <div className="section-content">
            <div className="measurements-grid">
              <div className="info-item">
                <label>Pit to Pit ("):</label>
                <input
                  type="text"
                  value={currentItem.measurements?.pitToPit || ''}
                  onChange={(e) => updateGroupField('measurements.pitToPit', e.target.value)}
                  placeholder="e.g., 22"
                  className="info-input"
                />
              </div>

              <div className="info-item">
                <label>Length ("):</label>
                <input
                  type="text"
                  value={currentItem.measurements?.length || ''}
                  onChange={(e) => updateGroupField('measurements.length', e.target.value)}
                  placeholder="e.g., 28"
                  className="info-input"
                />
              </div>

              <div className="info-item">
                <label>Sleeve ("):</label>
                <input
                  type="text"
                  value={currentItem.measurements?.sleeve || ''}
                  onChange={(e) => updateGroupField('measurements.sleeve', e.target.value)}
                  placeholder="e.g., 24"
                  className="info-input"
                />
              </div>

              <div className="info-item">
                <label>Shoulder ("):</label>
                <input
                  type="text"
                  value={currentItem.measurements?.shoulder || ''}
                  onChange={(e) => updateGroupField('measurements.shoulder', e.target.value)}
                  placeholder="e.g., 18"
                  className="info-input"
                />
              </div>

              <div className="info-item">
                <label>Waist ("):</label>
                <input
                  type="text"
                  value={currentItem.measurements?.waist || ''}
                  onChange={(e) => updateGroupField('measurements.waist', e.target.value)}
                  placeholder="e.g., 32"
                  className="info-input"
                />
              </div>

              <div className="info-item">
                <label>Rise ("):</label>
                <input
                  type="text"
                  value={currentItem.measurements?.rise || ''}
                  onChange={(e) => updateGroupField('measurements.rise', e.target.value)}
                  placeholder="e.g., 11"
                  className="info-input"
                />
              </div>

              <div className="info-item">
                <label>Inseam ("):</label>
                <input
                  type="text"
                  value={currentItem.measurements?.inseam || ''}
                  onChange={(e) => updateGroupField('measurements.inseam', e.target.value)}
                  placeholder="e.g., 30"
                  className="info-input"
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Section 4: Inventory & SKU */}
      <div className="form-section-collapsible">
        <div className="section-header" onClick={() => toggleSection('inventory')}>
          <span className="section-icon">{expandedSections.has('inventory') ? '▼' : '▶'}</span>
          <h3>📦 Inventory & SKU</h3>
          <span className="field-count">(4 fields)</span>
        </div>
        {expandedSections.has('inventory') && (
          <div className="section-content">
            <div className="info-item">
              <label>SKU:</label>
              <input
                type="text"
                value={currentItem.sku || ''}
                onChange={(e) => updateGroupField('sku', e.target.value)}
                placeholder="Stock keeping unit"
                className="info-input"
              />
            </div>

            <div className="info-item">
              <label>Barcode:</label>
              <input
                type="text"
                value={currentItem.barcode || ''}
                onChange={(e) => updateGroupField('barcode', e.target.value)}
                placeholder="Product barcode"
                className="info-input"
              />
            </div>

            <div className="info-item">
              <label>Inventory Quantity:</label>
              <input
                type="number"
                value={currentItem.inventoryQuantity || ''}
                onChange={(e) => updateGroupField('inventoryQuantity', e.target.value ? parseInt(e.target.value) : undefined)}
                placeholder="Stock level"
                className="info-input"
                min="0"
              />
            </div>

            <div className="info-item">
              <label>Weight (grams): <PresetBadge show={isFromPreset('weightValue')} /></label>
              <input
                type="text"
                value={currentItem.weightValue || ''}
                onChange={(e) => updateGroupField('weightValue', e.target.value)}
                placeholder="e.g., 350"
                className="info-input"
              />
            </div>
          </div>
        )}
      </div>

      {/* Section 5: Shipping & Packaging */}
      <div className="form-section-collapsible">
        <div className="section-header" onClick={() => toggleSection('shipping')}>
          <span className="section-icon">{expandedSections.has('shipping') ? '▼' : '▶'}</span>
          <h3>🚚 Shipping & Packaging</h3>
          <span className="field-count">(5 fields)</span>
        </div>
        {expandedSections.has('shipping') && (
          <div className="section-content">
            <div className="info-item">
              <label>Requires Shipping: <PresetBadge show={isFromPreset('requiresShipping')} /></label>
              <select
                value={currentItem.requiresShipping === undefined ? '' : currentItem.requiresShipping ? 'true' : 'false'}
                onChange={(e) => updateGroupField('requiresShipping', e.target.value === 'true')}
                className="info-input"
              >
                <option value="">Select...</option>
                <option value="true">Yes (Physical item)</option>
                <option value="false">No (Digital item)</option>
              </select>
            </div>

            <div className="info-item">
              <label>Package Dimensions: <PresetBadge show={isFromPreset('packageDimensions')} /></label>
              <input
                type="text"
                value={currentItem.packageDimensions || ''}
                onChange={(e) => updateGroupField('packageDimensions', e.target.value)}
                placeholder="e.g., 8 in - 6 in - 4 in"
                className="info-input"
              />
            </div>

            <div className="info-item">
              <label>Parcel Size: <PresetBadge show={isFromPreset('parcelSize')} /></label>
              <select
                value={currentItem.parcelSize || ''}
                onChange={(e) => updateGroupField('parcelSize', e.target.value)}
                className="info-input"
              >
                <option value="">Select parcel size...</option>
                <option value="Small">Small</option>
                <option value="Medium">Medium</option>
                <option value="Large">Large</option>
                <option value="Extra Large">Extra Large</option>
              </select>
            </div>

            <div className="info-item">
              <label>Ships From: <PresetBadge show={isFromPreset('shipsFrom')} /></label>
              <input
                type="text"
                value={currentItem.shipsFrom || ''}
                onChange={(e) => updateGroupField('shipsFrom', e.target.value)}
                placeholder="Shipping address"
                className="info-input"
              />
            </div>

            <div className="info-item">
              <label>Continue Selling Out of Stock: <PresetBadge show={isFromPreset('continueSellingOutOfStock')} /></label>
              <select
                value={currentItem.continueSellingOutOfStock === undefined ? '' : currentItem.continueSellingOutOfStock ? 'true' : 'false'}
                onChange={(e) => updateGroupField('continueSellingOutOfStock', e.target.value === 'true')}
                className="info-input"
              >
                <option value="">Select...</option>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            </div>
          </div>
        )}
      </div>

      {/* Section 6: Policies & Marketplace */}
      <div className="form-section-collapsible">
        <div className="section-header" onClick={() => toggleSection('policies')}>
          <span className="section-icon">{expandedSections.has('policies') ? '▼' : '▶'}</span>
          <h3>📜 Policies & Marketplace</h3>
          <span className="field-count">(6 fields)</span>
        </div>
        {expandedSections.has('policies') && (
          <div className="section-content">
            <div className="info-item">
              <label>Policies: <PresetBadge show={isFromPreset('policies')} /></label>
              <input
                type="text"
                value={currentItem.policies || ''}
                onChange={(e) => updateGroupField('policies', e.target.value)}
                placeholder="e.g., No Returns; No Exchanges"
                className="info-input"
              />
            </div>

            <div className="info-item">
              <label>Renewal Options: <PresetBadge show={isFromPreset('renewalOptions')} /></label>
              <input
                type="text"
                value={currentItem.renewalOptions || ''}
                onChange={(e) => updateGroupField('renewalOptions', e.target.value)}
                placeholder="e.g., Automatic, Manual"
                className="info-input"
              />
            </div>

            <div className="info-item">
              <label>Who Made It: <PresetBadge show={isFromPreset('whoMadeIt')} /></label>
              <input
                type="text"
                value={currentItem.whoMadeIt || ''}
                onChange={(e) => updateGroupField('whoMadeIt', e.target.value)}
                placeholder="e.g., Another Company Or Person"
                className="info-input"
              />
            </div>

            <div className="info-item">
              <label>What Is It: <PresetBadge show={isFromPreset('whatIsIt')} /></label>
              <input
                type="text"
                value={currentItem.whatIsIt || ''}
                onChange={(e) => updateGroupField('whatIsIt', e.target.value)}
                placeholder="e.g., A Finished Product"
                className="info-input"
              />
            </div>

            <div className="info-item">
              <label>Listing Type: <PresetBadge show={isFromPreset('listingType')} /></label>
              <input
                type="text"
                value={currentItem.listingType || ''}
                onChange={(e) => updateGroupField('listingType', e.target.value)}
                placeholder="e.g., Physical Item"
                className="info-input"
              />
            </div>

            <div className="info-item">
              <label>Discounted Shipping: <PresetBadge show={isFromPreset('discountedShipping')} /></label>
              <input
                type="text"
                value={currentItem.discountedShipping || ''}
                onChange={(e) => updateGroupField('discountedShipping', e.target.value)}
                placeholder="e.g., No Discount, 10% Off"
                className="info-input"
              />
            </div>
          </div>
        )}
      </div>

      {/* Section 7: Marketing & SEO */}
      <div className="form-section-collapsible">
        <div className="section-header" onClick={() => toggleSection('marketing')}>
          <span className="section-icon">{expandedSections.has('marketing') ? '▼' : '▶'}</span>
          <h3>📈 Marketing & SEO</h3>
          <span className="field-count">(2 fields)</span>
        </div>
        {expandedSections.has('marketing') && (
          <div className="section-content">
            <div className="info-item">
              <label>Custom Label 0: <PresetBadge show={isFromPreset('customLabel0')} /></label>
              <input
                type="text"
                value={currentItem.customLabel0 || ''}
                onChange={(e) => updateGroupField('customLabel0', e.target.value)}
                placeholder="e.g., Top Seller, New Arrival"
                className="info-input"
              />
            </div>

            <div className="info-item">
              <label>MPN (Manufacturer Part Number):</label>
              <input
                type="text"
                value={currentItem.mpn || ''}
                onChange={(e) => updateGroupField('mpn', e.target.value)}
                placeholder="Manufacturer part number"
                className="info-input"
              />
            </div>
          </div>
        )}
      </div>

      {/* Section 8: Status & Publishing */}
      <div className="form-section-collapsible">
        <div className="section-header" onClick={() => toggleSection('status')}>
          <span className="section-icon">{expandedSections.has('status') ? '▼' : '▶'}</span>
          <h3>⚡ Status & Publishing</h3>
          <span className="field-count">(2 fields)</span>
        </div>
        {expandedSections.has('status') && (
          <div className="section-content">
            <div className="info-item">
              <label>Status:</label>
              <select
                value={currentItem.status || 'Active'}
                onChange={(e) => updateGroupField('status', e.target.value)}
                className="info-input"
              >
                <option value="Active">Active</option>
                <option value="Draft">Draft</option>
                <option value="Archived">Archived</option>
              </select>
            </div>

            <div className="info-item">
              <label>Published:</label>
              <select
                value={currentItem.published === undefined ? 'true' : currentItem.published ? 'true' : 'false'}
                onChange={(e) => updateGroupField('published', e.target.value === 'true')}
                className="info-input"
              >
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

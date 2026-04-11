import React, { useEffect } from 'react';
import type { ClothingItem } from '../App';
import { extractGroupPrimaryColor } from '../lib/colorUtils';
import './ComprehensiveProductForm.css';

interface ComprehensiveProductFormProps {
  currentItem: ClothingItem;
  currentGroup: ClothingItem[];
  processedItems: ClothingItem[];
  setProcessedItems: (items: ClothingItem[]) => void;
}

export const ComprehensiveProductForm: React.FC<ComprehensiveProductFormProps> = ({
  currentItem,
  currentGroup,
  processedItems,
  setProcessedItems,
}) => {
  const updateGroupField = (fieldPath: string, value: any) => {
    const updated = [...processedItems];
    currentGroup.forEach(groupItem => {
      const itemIndex = updated.findIndex(item => item.id === groupItem.id);
      if (itemIndex !== -1) {
        const keys = fieldPath.split('.');
        if (keys.length === 1) {
          (updated[itemIndex] as any)[keys[0]] = value;
        } else {
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

  // ── Auto color detection ───────────────────────────────────────────────────
  // Runs once when this group first appears in Step 3 with an empty color field.
  // Samples all images in the group, votes across them, writes the dominant
  // color name. AI/voice/manual input all write to the same field afterwards
  // and naturally overwrite this value. Guard ensures we never re-run if the
  // field already has a value (from preset, voice, AI, or a prior run).
  useEffect(() => {
    if (currentItem.color) return; // already filled — skip

    const urls = currentGroup
      .map(item => item.imageUrls?.[0] || item.preview)
      .filter((url): url is string => !!url);

    if (!urls.length) return;

    let cancelled = false;
    extractGroupPrimaryColor(urls).then(colorName => {
      if (cancelled || !colorName) return;
      // Re-check guard in case voice/AI fired while we were sampling
      if (currentItem.color) return;
      updateGroupField('color', colorName);
    }).catch(() => { /* silently ignore — field stays blank */ });

    return () => { cancelled = true; };
    // Only re-run when the group identity changes (new group rendered)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentItem.id]);

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

      {/* Row 1: Pricing */}
      <div className="form-section-flat">
        <h3 className="form-section-title">💰 Pricing</h3>
        <div className="fields-row">
          <div className="info-item">
            <label>Price ($):</label>
            <input type="number" value={currentItem.price || ''} onChange={(e) => updateGroupField('price', e.target.value ? parseFloat(e.target.value) : undefined)} placeholder="e.g., 49.99" className="info-input" step="0.01" min="0" />
          </div>
          <div className="info-item">
            <label>Compare-at Price ($):</label>
            <input type="number" value={currentItem.compareAtPrice || ''} onChange={(e) => updateGroupField('compareAtPrice', e.target.value ? parseFloat(e.target.value) : undefined)} placeholder="Original price" className="info-input" step="0.01" min="0" />
          </div>
          <div className="info-item">
            <label>Cost Per Item ($):</label>
            <input type="number" value={currentItem.costPerItem || ''} onChange={(e) => updateGroupField('costPerItem', e.target.value ? parseFloat(e.target.value) : undefined)} placeholder="Your cost" className="info-input" step="0.01" min="0" />
          </div>
        </div>
      </div>

      {/* Row 2: Core Details */}
      <div className="form-section-flat">
        <h3 className="form-section-title">🏷️ Core Details</h3>
        <div className="fields-row">
          <div className="info-item">
            <label>Brand: <PresetBadge show={isFromPreset('brand')} /></label>
            <input type="text" value={currentItem.brand || ''} onChange={(e) => updateGroupField('brand', e.target.value)} placeholder="e.g., Nike, Levi's" className="info-input" />
          </div>
          <div className="info-item">
            <label>Size:</label>
            <input type="text" value={currentItem.size || ''} onChange={(e) => updateGroupField('size', e.target.value)} placeholder="e.g., M, L, XL" className="info-input" />
          </div>
          <div className="info-item">
            <label>Condition:</label>
            <select value={currentItem.condition || ''} onChange={(e) => updateGroupField('condition', e.target.value)} className="info-input">
              <option value="">Select condition...</option>
              <option value="New">New</option>
              <option value="NWT">NWT (New With Tags)</option>
              <option value="Excellent">Excellent</option>
              <option value="Good">Good</option>
              <option value="Fair">Fair</option>
              <option value="Used">Used</option>
            </select>
          </div>
        </div>
        <div className="fields-row">
          <div className="info-item">
            <label>Color:</label>
            <input type="text" value={currentItem.color || ''} onChange={(e) => updateGroupField('color', e.target.value)} placeholder="e.g., Black, Blue" className="info-input" />
          </div>
          <div className="info-item">
            <label>Secondary Color:</label>
            <input type="text" value={currentItem.secondaryColor || ''} onChange={(e) => updateGroupField('secondaryColor', e.target.value)} placeholder="Additional color" className="info-input" />
          </div>
          <div className="info-item">
            <label>Material: <PresetBadge show={isFromPreset('material')} /></label>
            <input type="text" value={currentItem.material || ''} onChange={(e) => updateGroupField('material', e.target.value)} placeholder="e.g., 100% Cotton" className="info-input" />
          </div>
        </div>
        <div className="fields-row">
          <div className="info-item">
            <label>Era/Vibe:</label>
            <input type="text" value={currentItem.era || ''} onChange={(e) => updateGroupField('era', e.target.value)} placeholder="e.g., 90s, Y2K, vintage" className="info-input" />
          </div>
          <div className="info-item">
            <label>Style: <PresetBadge show={isFromPreset('style')} /></label>
            <input type="text" value={currentItem.style || ''} onChange={(e) => updateGroupField('style', e.target.value)} placeholder="e.g., Streetwear, Preppy" className="info-input" />
          </div>
          <div className="info-item">
            <label>Gender: <PresetBadge show={isFromPreset('gender')} /></label>
            <select value={currentItem.gender || ''} onChange={(e) => updateGroupField('gender', e.target.value)} className="info-input">
              <option value="">Select gender...</option>
              <option value="Men">Men</option>
              <option value="Women">Women</option>
              <option value="Unisex">Unisex</option>
              <option value="Kids">Kids</option>
            </select>
          </div>
        </div>
        <div className="fields-row">
          <div className="info-item">
            <label>Product Type: <PresetBadge show={isFromPreset('productType')} /></label>
            <input type="text" value={currentItem.productType || ''} onChange={(e) => updateGroupField('productType', e.target.value)} placeholder="e.g., Graphic Tee, Hoodie" className="info-input" />
          </div>
          <div className="info-item">
            <label>Model Name:</label>
            <input type="text" value={currentItem.modelName || ''} onChange={(e) => updateGroupField('modelName', e.target.value)} placeholder="e.g., Air Force 1, 501" className="info-input" />
          </div>
          <div className="info-item">
            <label>Flaws (if any):</label>
            <input type="text" value={currentItem.flaws || ''} onChange={(e) => updateGroupField('flaws', e.target.value)} placeholder="e.g., minor pilling" className="info-input" />
          </div>
        </div>
        <div className="fields-row">
          <div className="info-item">
            <label>Tags (comma-separated): <PresetBadge show={isFromPreset('tags')} /></label>
            <input type="text" value={currentItem.tags?.join(', ') || ''} onChange={(e) => updateGroupField('tags', e.target.value ? e.target.value.split(',').map(t => t.trim()).filter(t => t) : [])} placeholder="e.g., vintage, tees, black" className="info-input" />
          </div>
          <div className="info-item">
            <label>SEO Title:</label>
            <input type="text" value={currentItem.seoTitle || ''} onChange={(e) => updateGroupField('seoTitle', e.target.value)} placeholder="e.g., Vintage Black Rolling Stones Tee" className="info-input" />
          </div>
          <div className="info-item">
            <label>Care Instructions: <PresetBadge show={isFromPreset('care')} /></label>
            <input type="text" value={currentItem.care || ''} onChange={(e) => updateGroupField('care', e.target.value)} placeholder="e.g., Machine wash cold" className="info-input" />
          </div>
        </div>
      </div>

      {/* Row 3: Measurements */}
      <div className="form-section-flat">
        <h3 className="form-section-title">📏 Measurements (inches)</h3>
        <div className="fields-row">
          <div className="info-item">
            <label>Width ("):</label>
            <input type="text" value={currentItem.measurements?.width || ''} onChange={(e) => updateGroupField('measurements.width', e.target.value)} placeholder="e.g., 22" className="info-input" />
          </div>
          <div className="info-item">
            <label>Length ("):</label>
            <input type="text" value={currentItem.measurements?.length || ''} onChange={(e) => updateGroupField('measurements.length', e.target.value)} placeholder="e.g., 28" className="info-input" />
          </div>
          <div className="info-item">
            <label>Sleeve ("):</label>
            <input type="text" value={currentItem.measurements?.sleeve || ''} onChange={(e) => updateGroupField('measurements.sleeve', e.target.value)} placeholder="e.g., 24" className="info-input" />
          </div>
        </div>
        <div className="fields-row">
          <div className="info-item">
            <label>Shoulder ("):</label>
            <input type="text" value={currentItem.measurements?.shoulder || ''} onChange={(e) => updateGroupField('measurements.shoulder', e.target.value)} placeholder="e.g., 18" className="info-input" />
          </div>
          <div className="info-item">
            <label>Waist ("):</label>
            <input type="text" value={currentItem.measurements?.waist || ''} onChange={(e) => updateGroupField('measurements.waist', e.target.value)} placeholder="e.g., 32" className="info-input" />
          </div>
          <div className="info-item">
            <label>Inseam ("):</label>
            <input type="text" value={currentItem.measurements?.inseam || ''} onChange={(e) => updateGroupField('measurements.inseam', e.target.value)} placeholder="e.g., 30" className="info-input" />
          </div>
        </div>
        <div className="fields-row">
          <div className="info-item">
            <label>Rise ("):</label>
            <input type="text" value={currentItem.measurements?.rise || ''} onChange={(e) => updateGroupField('measurements.rise', e.target.value)} placeholder="e.g., 11" className="info-input" />
          </div>
          <div className="info-item">{/* spacer */}</div>
          <div className="info-item">{/* spacer */}</div>
        </div>
      </div>

      {/* Row 4: Inventory & Shipping */}
      <div className="form-section-flat">
        <h3 className="form-section-title">📦 Inventory & Shipping</h3>
        <div className="fields-row">
          <div className="info-item">
            <label>SKU:</label>
            <input type="text" value={currentItem.sku || ''} onChange={(e) => updateGroupField('sku', e.target.value)} placeholder="Stock keeping unit" className="info-input" />
          </div>
          <div className="info-item">
            <label>Inventory Quantity:</label>
            <input type="number" value={currentItem.inventoryQuantity || ''} onChange={(e) => updateGroupField('inventoryQuantity', e.target.value ? parseInt(e.target.value) : undefined)} placeholder="Stock level" className="info-input" min="0" />
          </div>
          <div className="info-item">
            <label>Weight (grams): <PresetBadge show={isFromPreset('weightValue')} /></label>
            <input type="text" value={currentItem.weightValue || ''} onChange={(e) => updateGroupField('weightValue', e.target.value)} placeholder="e.g., 350" className="info-input" />
          </div>
        </div>
        <div className="fields-row">
          <div className="info-item">
            <label>Ships From: <PresetBadge show={isFromPreset('shipsFrom')} /></label>
            <input type="text" value={currentItem.shipsFrom || ''} onChange={(e) => updateGroupField('shipsFrom', e.target.value)} placeholder="Shipping location" className="info-input" />
          </div>
          <div className="info-item">
            <label>Parcel Size: <PresetBadge show={isFromPreset('parcelSize')} /></label>
            <select value={currentItem.parcelSize || ''} onChange={(e) => updateGroupField('parcelSize', e.target.value)} className="info-input">
              <option value="">Select size...</option>
              <option value="Small">Small</option>
              <option value="Medium">Medium</option>
              <option value="Large">Large</option>
              <option value="Extra Large">Extra Large</option>
            </select>
          </div>
          <div className="info-item">
            <label>Requires Shipping: <PresetBadge show={isFromPreset('requiresShipping')} /></label>
            <select value={currentItem.requiresShipping === undefined ? '' : currentItem.requiresShipping ? 'true' : 'false'} onChange={(e) => updateGroupField('requiresShipping', e.target.value === 'true')} className="info-input">
              <option value="">Select...</option>
              <option value="true">Yes (Physical)</option>
              <option value="false">No (Digital)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Row 5: Status & Publishing */}
      <div className="form-section-flat">
        <h3 className="form-section-title">⚡ Status & SEO</h3>
        <div className="fields-row">
          <div className="info-item">
            <label>Status:</label>
            <select value={currentItem.status || 'Active'} onChange={(e) => updateGroupField('status', e.target.value)} className="info-input">
              <option value="Active">Active</option>
              <option value="Draft">Draft</option>
              <option value="Archived">Archived</option>
            </select>
          </div>
          <div className="info-item">
            <label>Published:</label>
            <select value={currentItem.published === undefined ? 'true' : currentItem.published ? 'true' : 'false'} onChange={(e) => updateGroupField('published', e.target.value === 'true')} className="info-input">
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </div>
          <div className="info-item">
            <label>Age Group: <PresetBadge show={isFromPreset('ageGroup')} /></label>
            <input type="text" value={currentItem.ageGroup || ''} onChange={(e) => updateGroupField('ageGroup', e.target.value)} placeholder="e.g., Adult (13+ years)" className="info-input" />
          </div>
        </div>
        <div className="fields-row">
          <div className="info-item fields-row--span2">
            <label>SEO Description:</label>
            <textarea value={currentItem.seoDescription || ''} onChange={(e) => updateGroupField('seoDescription', e.target.value)} placeholder="Meta description for search engines" className="info-input" rows={2} />
          </div>
          <div className="info-item">
            <label>Size Type: <PresetBadge show={isFromPreset('sizeType')} /></label>
            <select value={currentItem.sizeType || ''} onChange={(e) => updateGroupField('sizeType', e.target.value)} className="info-input">
              <option value="">Select size type...</option>
              <option value="Regular">Regular</option>
              <option value="Big & Tall">Big &amp; Tall</option>
              <option value="Petite">Petite</option>
              <option value="Plus Size">Plus Size</option>
              <option value="One Size">One Size</option>
            </select>
          </div>
        </div>
      </div>

    </div>
  );
};


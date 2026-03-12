import React from 'react';
import type { ClothingItem } from '../App';
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

  const PresetBadge = ({ show }: { show: boolean }) => {
    if (!show) return null;
    return (
      <span className="preset-badge" title={`From "${currentItem._presetData?.displayName}" preset`}>
        Preset
      </span>
    );
  };

  return (
    <div className="comprehensive-product-form">

      {/* All sections always visible */}
      <div className="section-fields">

        {/* Basic Info */}
        <div id="section-basic" className="fields-group">
          <div className="fields-group-title">💰 Basic Info</div>
          <div className="fields-grid">
            <div className="info-item">
              <label>Price ($): <PresetBadge show={isFromPreset('price')} /></label>
              <input type="number" value={currentItem.price || ''} onChange={e => updateGroupField('price', e.target.value ? parseFloat(e.target.value) : undefined)} placeholder="49.99" className="info-input" step="0.01" min="0" />
            </div>
            <div className="info-item">
              <label>Compare-at ($):</label>
              <input type="number" value={currentItem.compareAtPrice || ''} onChange={e => updateGroupField('compareAtPrice', e.target.value ? parseFloat(e.target.value) : undefined)} placeholder="Original price" className="info-input" step="0.01" min="0" />
            </div>
            <div className="info-item">
              <label>Cost Per Item ($):</label>
              <input type="number" value={currentItem.costPerItem || ''} onChange={e => updateGroupField('costPerItem', e.target.value ? parseFloat(e.target.value) : undefined)} placeholder="Your cost" className="info-input" step="0.01" min="0" />
            </div>
            <div className="info-item">
              <label>Brand: <PresetBadge show={isFromPreset('brand')} /></label>
              <input type="text" value={currentItem.brand || ''} onChange={e => updateGroupField('brand', e.target.value)} placeholder="Nike, Levi's, unbranded…" className="info-input" />
            </div>
            <div className="info-item">
              <label>Condition:</label>
              <select value={currentItem.condition || ''} onChange={e => updateGroupField('condition', e.target.value)} className="info-input">
                <option value="">Select…</option>
                <option value="New">New</option>
                <option value="NWT">NWT (New With Tags)</option>
                <option value="Excellent">Excellent</option>
                <option value="Good">Good</option>
                <option value="Fair">Fair</option>
                <option value="Used">Used</option>
              </select>
            </div>
            <div className="info-item">
              <label>Product Type: <PresetBadge show={isFromPreset('productType')} /></label>
              <input type="text" value={currentItem.productType || ''} onChange={e => updateGroupField('productType', e.target.value)} placeholder="Graphic Tee, Hoodie…" className="info-input" />
            </div>
            <div className="info-item span-2">
              <label>SEO Title:</label>
              <input type="text" value={currentItem.seoTitle || ''} onChange={e => updateGroupField('seoTitle', e.target.value)} placeholder="Vintage Black Rolling Stones Tee" className="info-input" />
            </div>
            <div className="info-item span-2">
              <label>Tags (comma-separated): <PresetBadge show={isFromPreset('tags')} /></label>
              <input type="text" value={currentItem.tags?.join(', ') || ''} onChange={e => updateGroupField('tags', e.target.value ? e.target.value.split(',').map((t: string) => t.trim()).filter((t: string) => t) : [])} placeholder="vintage, tees, rock, black" className="info-input" />
            </div>
            <div className="info-item span-2">
              <label>Flaws (if any):</label>
              <input type="text" value={currentItem.flaws || ''} onChange={e => updateGroupField('flaws', e.target.value)} placeholder="minor pilling on sleeves, small stain on hem" className="info-input" />
            </div>
          </div>
        </div>

        {/* Product Details */}
        <div id="section-details" className="fields-group">
          <div className="fields-group-title">📋 Product Details</div>
          <div className="fields-grid">
            <div className="info-item">
              <label>Size:</label>
              <input type="text" list="size-options" value={currentItem.size || ''} onChange={e => updateGroupField('size', e.target.value)} placeholder="M, L, XL, 32…" className="info-input" />
              <datalist id="size-options">
                <option value="XS" /><option value="S" /><option value="M" /><option value="L" /><option value="XL" /><option value="XXL" /><option value="3XL" /><option value="4XL" /><option value="1 SIZE" />
              </datalist>
            </div>
            <div className="info-item">
              <label>Color:</label>
              <input type="text" value={currentItem.color || ''} onChange={e => updateGroupField('color', e.target.value)} placeholder="Black, Blue…" className="info-input" />
            </div>
            <div className="info-item">
              <label>Secondary Color:</label>
              <input type="text" value={currentItem.secondaryColor || ''} onChange={e => updateGroupField('secondaryColor', e.target.value)} placeholder="Additional color" className="info-input" />
            </div>
            <div className="info-item">
              <label>Material: <PresetBadge show={isFromPreset('material')} /></label>
              <input type="text" value={currentItem.material || ''} onChange={e => updateGroupField('material', e.target.value)} placeholder="100% Cotton…" className="info-input" />
            </div>
            <div className="info-item">
              <label>Era/Vibe:</label>
              <input type="text" value={currentItem.era || ''} onChange={e => updateGroupField('era', e.target.value)} placeholder="90s, Y2K, vintage" className="info-input" />
            </div>
            <div className="info-item">
              <label>Style: <PresetBadge show={isFromPreset('style')} /></label>
              <input type="text" value={currentItem.style || ''} onChange={e => updateGroupField('style', e.target.value)} placeholder="Vintage, Streetwear…" className="info-input" />
            </div>
            <div className="info-item">
              <label>Gender: <PresetBadge show={isFromPreset('gender')} /></label>
              <select value={currentItem.gender || ''} onChange={e => updateGroupField('gender', e.target.value)} className="info-input">
                <option value="">Select…</option>
                <option value="Men">Men</option>
                <option value="Women">Women</option>
                <option value="Unisex">Unisex</option>
                <option value="Kids">Kids</option>
              </select>
            </div>
            <div className="info-item">
              <label>Age Group: <PresetBadge show={isFromPreset('ageGroup')} /></label>
              <input type="text" value={currentItem.ageGroup || ''} onChange={e => updateGroupField('ageGroup', e.target.value)} placeholder="Adult (13+ years old)" className="info-input" />
            </div>
            <div className="info-item">
              <label>Size Type: <PresetBadge show={isFromPreset('sizeType')} /></label>
              <select value={currentItem.sizeType || ''} onChange={e => updateGroupField('sizeType', e.target.value)} className="info-input">
                <option value="">Select…</option>
                <option value="Regular">Regular</option>
                <option value="Big & Tall">Big &amp; Tall</option>
                <option value="Petite">Petite</option>
                <option value="Plus Size">Plus Size</option>
                <option value="One Size">One Size</option>
              </select>
            </div>
            <div className="info-item">
              <label>Model Name:</label>
              <input type="text" value={currentItem.modelName || ''} onChange={e => updateGroupField('modelName', e.target.value)} placeholder="Air Force 1, 501…" className="info-input" />
            </div>
            <div className="info-item">
              <label>Model Number:</label>
              <input type="text" value={currentItem.modelNumber || ''} onChange={e => updateGroupField('modelNumber', e.target.value)} placeholder="AF1, 501, MA-1" className="info-input" />
            </div>
            <div className="info-item">
              <label>Care Instructions: <PresetBadge show={isFromPreset('care')} /></label>
              <input type="text" value={currentItem.care || ''} onChange={e => updateGroupField('care', e.target.value)} placeholder="Machine wash cold" className="info-input" />
            </div>
            <div className="info-item span-2">
              <label>SEO Description:</label>
              <textarea value={currentItem.seoDescription || ''} onChange={e => updateGroupField('seoDescription', e.target.value)} placeholder="Meta description for search engines" className="info-input" rows={2} />
            </div>
          </div>
        </div>

        {/* Measurements */}
        <div id="section-measurements" className="fields-group">
          <div className="fields-group-title">📏 Measurements</div>
          <div className="fields-grid-3">
            {([
              ['measurements.width',    'Width (")'],
              ['measurements.length',   'Length (")'],
              ['measurements.sleeve',   'Sleeve (")'],
              ['measurements.shoulder', 'Shoulder (")'],
              ['measurements.waist',    'Waist (")'],
              ['measurements.rise',     'Rise (")'],
              ['measurements.inseam',   'Inseam (")'],
            ] as [string, string][]).map(([field, lbl]) => {
              const subKey = field.split('.')[1] as keyof NonNullable<ClothingItem['measurements']>;
              return (
                <div className="info-item" key={field}>
                  <label>{lbl}:</label>
                  <input type="text" value={currentItem.measurements?.[subKey] || ''} onChange={e => updateGroupField(field, e.target.value)} placeholder="e.g., 22" className="info-input" />
                </div>
              );
            })}
          </div>
        </div>

        {/* Inventory & SKU */}
        <div id="section-inventory" className="fields-group">
          <div className="fields-group-title">📦 Inventory &amp; SKU</div>
          <div className="fields-grid">
            <div className="info-item">
              <label>SKU:</label>
              <input type="text" value={currentItem.sku || ''} onChange={e => updateGroupField('sku', e.target.value)} placeholder="Stock keeping unit" className="info-input" />
            </div>
            <div className="info-item">
              <label>Barcode:</label>
              <input type="text" value={currentItem.barcode || ''} onChange={e => updateGroupField('barcode', e.target.value)} placeholder="Product barcode" className="info-input" />
            </div>
            <div className="info-item">
              <label>Inventory Qty:</label>
              <input type="number" value={currentItem.inventoryQuantity || ''} onChange={e => updateGroupField('inventoryQuantity', e.target.value ? parseInt(e.target.value) : undefined)} placeholder="Stock level" className="info-input" min="0" />
            </div>
            <div className="info-item">
              <label>Weight (g): <PresetBadge show={isFromPreset('weightValue')} /></label>
              <input type="text" value={currentItem.weightValue || ''} onChange={e => updateGroupField('weightValue', e.target.value)} placeholder="e.g., 350" className="info-input" />
            </div>
          </div>
        </div>

        {/* Shipping */}
        <div id="section-shipping" className="fields-group">
          <div className="fields-group-title">🚚 Shipping</div>
          <div className="fields-grid-3">
            <div className="info-item">
              <label>Requires Shipping: <PresetBadge show={isFromPreset('requiresShipping')} /></label>
              <select value={currentItem.requiresShipping === undefined ? '' : currentItem.requiresShipping ? 'true' : 'false'} onChange={e => updateGroupField('requiresShipping', e.target.value === 'true')} className="info-input">
                <option value="">Select…</option>
                <option value="true">Yes (Physical)</option>
                <option value="false">No (Digital)</option>
              </select>
            </div>
            <div className="info-item">
              <label>Parcel Size: <PresetBadge show={isFromPreset('parcelSize')} /></label>
              <select value={currentItem.parcelSize || ''} onChange={e => updateGroupField('parcelSize', e.target.value)} className="info-input">
                <option value="">Select…</option>
                <option value="Small">Small</option>
                <option value="Medium">Medium</option>
                <option value="Large">Large</option>
                <option value="Extra Large">Extra Large</option>
              </select>
            </div>
            <div className="info-item">
              <label>Ships From: <PresetBadge show={isFromPreset('shipsFrom')} /></label>
              <input type="text" value={currentItem.shipsFrom || ''} onChange={e => updateGroupField('shipsFrom', e.target.value)} placeholder="Shipping address" className="info-input" />
            </div>
            <div className="info-item">
              <label>Discounted Shipping: <PresetBadge show={isFromPreset('discountedShipping')} /></label>
              <input type="text" value={currentItem.discountedShipping || ''} onChange={e => updateGroupField('discountedShipping', e.target.value)} placeholder="No Discount, 10% Off…" className="info-input" />
            </div>
            <div className="info-item span-3">
              <label>Package Dimensions: <PresetBadge show={isFromPreset('packageDimensions')} /></label>
              <input type="text" value={currentItem.packageDimensions || ''} onChange={e => updateGroupField('packageDimensions', e.target.value)} placeholder="8 in - 6 in - 4 in" className="info-input" />
            </div>
            <div className="info-item span-3">
              <label>Continue Selling Out of Stock: <PresetBadge show={isFromPreset('continueSellingOutOfStock')} /></label>
              <select value={currentItem.continueSellingOutOfStock === undefined ? '' : currentItem.continueSellingOutOfStock ? 'true' : 'false'} onChange={e => updateGroupField('continueSellingOutOfStock', e.target.value === 'true')} className="info-input">
                <option value="">Select…</option>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            </div>
          </div>
        </div>

        {/* Policies & Marketplace */}
        <div id="section-policies" className="fields-group">
          <div className="fields-group-title">📜 Policies &amp; Marketplace</div>
          <div className="fields-grid-3">
            <div className="info-item span-3">
              <label>Policies: <PresetBadge show={isFromPreset('policies')} /></label>
              <input type="text" value={currentItem.policies || ''} onChange={e => updateGroupField('policies', e.target.value)} placeholder="No Returns; No Exchanges" className="info-input" />
            </div>
            <div className="info-item">
              <label>Renewal Options: <PresetBadge show={isFromPreset('renewalOptions')} /></label>
              <input type="text" value={currentItem.renewalOptions || ''} onChange={e => updateGroupField('renewalOptions', e.target.value)} placeholder="Automatic, Manual" className="info-input" />
            </div>
            <div className="info-item">
              <label>Who Made It: <PresetBadge show={isFromPreset('whoMadeIt')} /></label>
              <input type="text" value={currentItem.whoMadeIt || ''} onChange={e => updateGroupField('whoMadeIt', e.target.value)} placeholder="Another Company Or Person" className="info-input" />
            </div>
            <div className="info-item">
              <label>What Is It: <PresetBadge show={isFromPreset('whatIsIt')} /></label>
              <input type="text" value={currentItem.whatIsIt || ''} onChange={e => updateGroupField('whatIsIt', e.target.value)} placeholder="A Finished Product" className="info-input" />
            </div>
            <div className="info-item span-3">
              <label>Listing Type: <PresetBadge show={isFromPreset('listingType')} /></label>
              <input type="text" value={currentItem.listingType || ''} onChange={e => updateGroupField('listingType', e.target.value)} placeholder="Physical Item" className="info-input" />
            </div>
          </div>
        </div>

        {/* Marketing & SEO */}
        <div id="section-marketing" className="fields-group">
          <div className="fields-group-title">📈 Marketing &amp; SEO</div>
          <div className="fields-grid">
            <div className="info-item">
              <label>Custom Label 0: <PresetBadge show={isFromPreset('customLabel0')} /></label>
              <input type="text" value={currentItem.customLabel0 || ''} onChange={e => updateGroupField('customLabel0', e.target.value)} placeholder="Top Seller, New Arrival" className="info-input" />
            </div>
            <div className="info-item">
              <label>MPN:</label>
              <input type="text" value={currentItem.mpn || ''} onChange={e => updateGroupField('mpn', e.target.value)} placeholder="Manufacturer part number" className="info-input" />
            </div>
          </div>
        </div>

        {/* Status & Publishing */}
        <div id="section-status" className="fields-group">
          <div className="fields-group-title">⚡ Status &amp; Publishing</div>
          <div className="fields-grid">
            <div className="info-item">
              <label>Status:</label>
              <select value={currentItem.status || 'Active'} onChange={e => updateGroupField('status', e.target.value)} className="info-input">
                <option value="Active">Active</option>
                <option value="Draft">Draft</option>
                <option value="Archived">Archived</option>
              </select>
            </div>
            <div className="info-item">
              <label>Published:</label>
              <select value={currentItem.published === undefined ? 'true' : currentItem.published ? 'true' : 'false'} onChange={e => updateGroupField('published', e.target.value === 'true')} className="info-input">
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};

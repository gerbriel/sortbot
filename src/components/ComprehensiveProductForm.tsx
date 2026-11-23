import React from 'react';
import { ArrowLeft } from 'lucide-react';
import type { ClothingItem } from '../App';
import { normalizeSizeValue } from '../lib/textAIService';
import { Badge } from './ui/Badge';
import { FieldCell, FieldGrid, FieldGroup } from './ui/FieldGrid';
import type { FieldCellControlProps } from './ui/FieldGrid';
import './ComprehensiveProductForm.css';

interface ComprehensiveProductFormProps {
  currentItem: ClothingItem;
  currentGroup: ClothingItem[];
  processedItems: ClothingItem[];
  setProcessedItems: (items: ClothingItem[]) => void;
  /** Rendered directly under the Brand input (the Brand cell's footer): the brand-spelling surface. */
  brandExtra?: React.ReactNode;
  /** Fired when the seller types over the Brand field (report 14's "remember"). */
  onBrandEdited?: (value: string) => void;
}

export const ComprehensiveProductForm: React.FC<ComprehensiveProductFormProps> = ({
  currentItem,
  currentGroup,
  processedItems,
  setProcessedItems,
  brandExtra,
  onBrandEdited,
}) => {
  // Always highlight empty fields: visible on load, after voice, after reload
  const req = (value: any): string =>
    !value ? ' field-required-empty' : '';

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

  // Plain render helpers (not components: components created during render
  // violate the react-hooks purity rule). Both go in a cell's meta slot.
  const presetBadge = (fieldName: string) => {
    if (!isFromPreset(fieldName)) return null;
    return (
      <span title={`From "${currentItem._presetData?.displayName}" preset`} style={{ cursor: 'help' }}>
        <Badge tone="accent" icon={<ArrowLeft size={11} />}>Preset</Badge>
      </span>
    );
  };

  // The control class every cell hands out, plus the empty-field class. The
  // class stays on the control; FieldGrid.css draws the marker on its cell.
  const cls = (c: FieldCellControlProps, value?: unknown) => `${c.className}${req(value)}`;

  // Meta slot for a field that carries the empty-field class: any badge first,
  // then the quiet "Required" word while the value is empty. Every required
  // cell renders its marker this way, so the word never moves.
  const need = (value: unknown, extra?: React.ReactNode) => {
    const empty = !value;
    if (!extra && !empty) return null;
    return (
      <>
        {extra}
        {empty && <span className="field-required-note">Required</span>}
      </>
    );
  };

  // The preset's measurement template marks which measurements this category
  // expects (the checkbox grid in the Presets manager). Flagged-and-empty gets
  // a "needed" badge so the seller knows what to measure; nothing is hidden.
  const measurementTemplate = currentItem._presetData?.measurementTemplate as
    | Record<string, boolean>
    | undefined;

  // A measurement's meta: the preset's "Needed" badge when the template flags
  // it, otherwise the same "Required" word every other empty field shows
  // (never both: "Needed" already says it).
  const measurementNeeded = (field: string, value?: string) => {
    if (!measurementTemplate?.[field] || value) return need(value);
    return (
      <span title={`The "${currentItem._presetData?.displayName}" preset expects this measurement`}>
        <Badge tone="warning">Needed</Badge>
      </span>
    );
  };

  return (
    <div className="comprehensive-product-form">

      <FieldGroup caption="Pricing" data-section="pricing">
        <FieldGrid columns={3}>
          <FieldCell label="Price ($)" meta={need(currentItem.price)}>
            {(c) => <input {...c} type="number" value={currentItem.price || ''} onChange={(e) => updateGroupField('price', e.target.value ? parseFloat(e.target.value) : undefined)} placeholder="e.g., 49.99" className={cls(c, currentItem.price)} step="0.01" min="0" />}
          </FieldCell>
          <FieldCell label="Compare-at price ($)">
            {(c) => <input {...c} type="number" value={currentItem.compareAtPrice || ''} onChange={(e) => updateGroupField('compareAtPrice', e.target.value ? parseFloat(e.target.value) : undefined)} placeholder="Original price" step="0.01" min="0" />}
          </FieldCell>
          <FieldCell label="Cost per item ($)">
            {(c) => <input {...c} type="number" value={currentItem.costPerItem || ''} onChange={(e) => updateGroupField('costPerItem', e.target.value ? parseFloat(e.target.value) : undefined)} placeholder="Your cost" step="0.01" min="0" />}
          </FieldCell>
        </FieldGrid>
      </FieldGroup>

      <FieldGroup caption="Core details" data-section="core">
        <FieldGrid columns={3}>
          <FieldCell label="Brand" meta={need(currentItem.brand, presetBadge('brand'))} footer={brandExtra}>
            {(c) => <input {...c} type="text" value={currentItem.brand || ''} onChange={(e) => updateGroupField('brand', e.target.value)} onBlur={(e) => onBrandEdited?.(e.target.value)} placeholder="e.g., Nike, Levi's" className={cls(c, currentItem.brand)} />}
          </FieldCell>
          <FieldCell label="Size" meta={need(currentItem.size)}>
            {(c) => <input {...c} type="text" value={currentItem.size || ''} onChange={(e) => updateGroupField('size', e.target.value)} onBlur={(e) => { const norm = normalizeSizeValue(e.target.value, { keepFitsLike: true }); if (norm && norm !== e.target.value) updateGroupField('size', norm); }} placeholder="M · 1X · 32x34 · YM · PS" className={cls(c, currentItem.size)} />}
          </FieldCell>
          <FieldCell label="Condition" meta={need(currentItem.condition)}>
            {(c) => (
            <select {...c} value={currentItem.condition || ''} onChange={(e) => updateGroupField('condition', e.target.value)} className={cls(c, currentItem.condition)}>
              <option value="">Select condition...</option>
              <option value="New">New</option>
              <option value="NWT">NWT (New With Tags)</option>
              <option value="Excellent">Excellent</option>
              <option value="Good">Good</option>
              <option value="Fair">Fair</option>
              <option value="Used">Used</option>
            </select>
            )}
          </FieldCell>
          <FieldCell label="Color" meta={need(currentItem.color)}>
            {(c) => <input {...c} type="text" value={currentItem.color || ''} onChange={(e) => updateGroupField('color', e.target.value)} placeholder="e.g., Black, Blue" className={cls(c, currentItem.color)} />}
          </FieldCell>
          <FieldCell label="Secondary color">
            {(c) => <input {...c} type="text" value={currentItem.secondaryColor || ''} onChange={(e) => updateGroupField('secondaryColor', e.target.value)} placeholder="Additional color" />}
          </FieldCell>
          <FieldCell label="Material" meta={need(currentItem.material, presetBadge('material'))}>
            {(c) => <input {...c} type="text" value={currentItem.material || ''} onChange={(e) => updateGroupField('material', e.target.value)} placeholder="e.g., 100% Cotton" className={cls(c, currentItem.material)} />}
          </FieldCell>
          <FieldCell label="Era or vibe" meta={need(currentItem.era)}>
            {(c) => <input {...c} type="text" value={currentItem.era || ''} onChange={(e) => updateGroupField('era', e.target.value)} placeholder="e.g., 90s, Y2K, vintage" className={cls(c, currentItem.era)} />}
          </FieldCell>
          <FieldCell label="Style" meta={need(currentItem.style, presetBadge('style'))}>
            {(c) => <input {...c} type="text" value={currentItem.style || ''} onChange={(e) => updateGroupField('style', e.target.value)} placeholder="e.g., Streetwear, Preppy" className={cls(c, currentItem.style)} />}
          </FieldCell>
          <FieldCell label="Gender" meta={need(currentItem.gender, presetBadge('gender'))}>
            {(c) => (
            <select {...c} value={currentItem.gender || ''} onChange={(e) => updateGroupField('gender', e.target.value)} className={cls(c, currentItem.gender)}>
              <option value="">Select gender...</option>
              <option value="Men">Men</option>
              <option value="Women">Women</option>
              <option value="Unisex">Unisex</option>
              <option value="Kids">Kids</option>
            </select>
            )}
          </FieldCell>
          <FieldCell label="Type (garment)" meta={need(currentItem.productType, presetBadge('productType'))}>
            {(c) => <input {...c} type="text" value={currentItem.productType || ''} onChange={(e) => updateGroupField('productType', e.target.value)} placeholder="e.g., Sweater, Hoodie, Pants" className={cls(c, currentItem.productType)} />}
          </FieldCell>
          <FieldCell label="Model name" meta={need(currentItem.modelName)}>
            {(c) => <input {...c} type="text" value={currentItem.modelName || ''} onChange={(e) => updateGroupField('modelName', e.target.value)} placeholder="e.g., Air Force 1, 501" className={cls(c, currentItem.modelName)} />}
          </FieldCell>
          <FieldCell label="Flaws (if any)" meta={need(currentItem.flaws)}>
            {(c) => <input {...c} type="text" value={currentItem.flaws || ''} onChange={(e) => updateGroupField('flaws', e.target.value)} placeholder="e.g., minor pilling" className={cls(c, currentItem.flaws)} />}
          </FieldCell>
          <FieldCell label="Tags (comma-separated)" meta={need(currentItem.tags?.length, presetBadge('tags'))}>
            {(c) => <input {...c} type="text" value={currentItem.tags?.join(', ') || ''} onChange={(e) => updateGroupField('tags', e.target.value ? e.target.value.split(',').map(t => t.trim()).filter(t => t) : [])} placeholder="e.g., vintage, tees, black" className={cls(c, currentItem.tags?.length)} />}
          </FieldCell>
          <FieldCell label="SEO title" meta={need(currentItem.seoTitle)}>
            {(c) => <input {...c} type="text" value={currentItem.seoTitle || ''} onChange={(e) => updateGroupField('seoTitle', e.target.value)} placeholder="e.g., Vintage Black Rolling Stones Tee" className={cls(c, currentItem.seoTitle)} />}
          </FieldCell>
          <FieldCell label="Care instructions" meta={need(currentItem.care, presetBadge('care'))}>
            {(c) => <input {...c} type="text" value={currentItem.care || ''} onChange={(e) => updateGroupField('care', e.target.value)} placeholder="e.g., Machine wash cold" className={cls(c, currentItem.care)} />}
          </FieldCell>
        </FieldGrid>
      </FieldGroup>

      <FieldGroup caption="Measurements (inches)" data-section="measurements">
        <FieldGrid columns={3}>
          <FieldCell label="Width" meta={measurementNeeded('width', currentItem.measurements?.width)}>
            {(c) => <input {...c} type="text" value={currentItem.measurements?.width || ''} onChange={(e) => updateGroupField('measurements.width', e.target.value)} placeholder="e.g., 22" className={cls(c, currentItem.measurements?.width)} />}
          </FieldCell>
          <FieldCell label="Length" meta={measurementNeeded('length', currentItem.measurements?.length)}>
            {(c) => <input {...c} type="text" value={currentItem.measurements?.length || ''} onChange={(e) => updateGroupField('measurements.length', e.target.value)} placeholder="e.g., 28" className={cls(c, currentItem.measurements?.length)} />}
          </FieldCell>
          <FieldCell label="Sleeve" meta={measurementNeeded('sleeve', currentItem.measurements?.sleeve)}>
            {(c) => <input {...c} type="text" value={currentItem.measurements?.sleeve || ''} onChange={(e) => updateGroupField('measurements.sleeve', e.target.value)} placeholder="e.g., 24" className={cls(c, currentItem.measurements?.sleeve)} />}
          </FieldCell>
          <FieldCell label="Shoulder" meta={measurementNeeded('shoulder', currentItem.measurements?.shoulder)}>
            {(c) => <input {...c} type="text" value={currentItem.measurements?.shoulder || ''} onChange={(e) => updateGroupField('measurements.shoulder', e.target.value)} placeholder="e.g., 18" className={cls(c, currentItem.measurements?.shoulder)} />}
          </FieldCell>
          <FieldCell label="Waist" meta={measurementNeeded('waist', currentItem.measurements?.waist)}>
            {(c) => <input {...c} type="text" value={currentItem.measurements?.waist || ''} onChange={(e) => updateGroupField('measurements.waist', e.target.value)} placeholder="e.g., 32" className={cls(c, currentItem.measurements?.waist)} />}
          </FieldCell>
          <FieldCell label="Inseam" meta={measurementNeeded('inseam', currentItem.measurements?.inseam)}>
            {(c) => <input {...c} type="text" value={currentItem.measurements?.inseam || ''} onChange={(e) => updateGroupField('measurements.inseam', e.target.value)} placeholder="e.g., 30" className={cls(c, currentItem.measurements?.inseam)} />}
          </FieldCell>
          <FieldCell label="Rise" meta={measurementNeeded('rise', currentItem.measurements?.rise)}>
            {(c) => <input {...c} type="text" value={currentItem.measurements?.rise || ''} onChange={(e) => updateGroupField('measurements.rise', e.target.value)} placeholder="e.g., 11" className={cls(c, currentItem.measurements?.rise)} />}
          </FieldCell>
        </FieldGrid>
      </FieldGroup>

      <FieldGroup caption="Inventory and shipping" data-section="inventory">
        <FieldGrid columns={3}>
          <FieldCell label="SKU" meta={need(currentItem.sku)}>
            {(c) => <input {...c} type="text" value={currentItem.sku || ''} onChange={(e) => updateGroupField('sku', e.target.value)} placeholder="Stock keeping unit" className={cls(c, currentItem.sku)} />}
          </FieldCell>
          <FieldCell label="Inventory quantity">
            {(c) => <input {...c} type="number" value={currentItem.inventoryQuantity || ''} onChange={(e) => updateGroupField('inventoryQuantity', e.target.value ? parseInt(e.target.value) : undefined)} placeholder="Stock level" min="0" />}
          </FieldCell>
          <FieldCell label="Weight (grams)" meta={need(currentItem.weightValue, presetBadge('weightValue'))}>
            {(c) => <input {...c} type="text" value={currentItem.weightValue || ''} onChange={(e) => updateGroupField('weightValue', e.target.value)} placeholder="e.g., 350" className={cls(c, currentItem.weightValue)} />}
          </FieldCell>
          <FieldCell label="Ships from" meta={need(currentItem.shipsFrom, presetBadge('shipsFrom'))}>
            {(c) => <input {...c} type="text" value={currentItem.shipsFrom || ''} onChange={(e) => updateGroupField('shipsFrom', e.target.value)} placeholder="Shipping location" className={cls(c, currentItem.shipsFrom)} />}
          </FieldCell>
          <FieldCell label="Parcel size" meta={need(currentItem.parcelSize, presetBadge('parcelSize'))}>
            {(c) => (
            <select {...c} value={currentItem.parcelSize || ''} onChange={(e) => updateGroupField('parcelSize', e.target.value)} className={cls(c, currentItem.parcelSize)}>
              <option value="">Select size...</option>
              <option value="Small">Small</option>
              <option value="Medium">Medium</option>
              <option value="Large">Large</option>
              <option value="Extra Large">Extra Large</option>
            </select>
            )}
          </FieldCell>
          <FieldCell label="Package dimensions" meta={need(currentItem.packageDimensions, presetBadge('packageDimensions'))}>
            {(c) => <input {...c} type="text" value={currentItem.packageDimensions || ''} onChange={(e) => updateGroupField('packageDimensions', e.target.value)} placeholder="e.g., 14 x 10 x 1 in" className={cls(c, currentItem.packageDimensions)} />}
          </FieldCell>
          <FieldCell label="Requires shipping" meta={presetBadge('requiresShipping')}>
            {(c) => (
            <select {...c} value={currentItem.requiresShipping === undefined ? '' : currentItem.requiresShipping ? 'true' : 'false'} onChange={(e) => updateGroupField('requiresShipping', e.target.value === 'true')}>
              <option value="">Select...</option>
              <option value="true">Yes (Physical)</option>
              <option value="false">No (Digital)</option>
            </select>
            )}
          </FieldCell>
        </FieldGrid>
      </FieldGroup>

      <FieldGroup caption="Status and SEO" data-section="status">
        <FieldGrid columns={3}>
          <FieldCell label="Status">
            {(c) => (
            <select {...c} value={currentItem.status || 'Active'} onChange={(e) => updateGroupField('status', e.target.value)}>
              <option value="Active">Active</option>
              <option value="Draft">Draft</option>
              <option value="Archived">Archived</option>
            </select>
            )}
          </FieldCell>
          <FieldCell label="Published">
            {(c) => (
            <select {...c} value={currentItem.published === undefined ? 'true' : currentItem.published ? 'true' : 'false'} onChange={(e) => updateGroupField('published', e.target.value === 'true')}>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
            )}
          </FieldCell>
          <FieldCell label="Age group" meta={need(currentItem.ageGroup, presetBadge('ageGroup'))}>
            {(c) => <input {...c} type="text" value={currentItem.ageGroup || ''} onChange={(e) => updateGroupField('ageGroup', e.target.value)} placeholder="e.g., Adult (13+ years)" className={cls(c, currentItem.ageGroup)} />}
          </FieldCell>
          <FieldCell label="SEO description" span={2} meta={need(currentItem.seoDescription)}>
            {(c) => <textarea {...c} value={currentItem.seoDescription || ''} onChange={(e) => updateGroupField('seoDescription', e.target.value)} placeholder="Meta description for search engines" className={`${c.className} js-autogrow${req(currentItem.seoDescription)}`} rows={2} />}
          </FieldCell>
          <FieldCell label="Size type" meta={presetBadge('sizeType')}>
            {(c) => (
            <select {...c} value={currentItem.sizeType || ''} onChange={(e) => updateGroupField('sizeType', e.target.value)}>
              <option value="">Select size type...</option>
              <option value="Regular">Regular</option>
              <option value="Big & Tall">Big &amp; Tall</option>
              <option value="Petite">Petite</option>
              <option value="Plus Size">Plus Size</option>
              <option value="One Size">One Size</option>
            </select>
            )}
          </FieldCell>
        </FieldGrid>
      </FieldGroup>

    </div>
  );
};


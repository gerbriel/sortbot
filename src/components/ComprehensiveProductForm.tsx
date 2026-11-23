import React from 'react';
import { ArrowLeft } from 'lucide-react';
import type { ClothingItem } from '../App';
import { normalizeSizeValue } from '../lib/textAIService';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
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
  /** Assign this listing's codes under the workspace convention. Shown in the
   *  SKU cell's meta slot only while the SKU is empty. */
  onGenerateSku?: () => void;
}

export const ComprehensiveProductForm: React.FC<ComprehensiveProductFormProps> = ({
  currentItem,
  currentGroup,
  processedItems,
  setProcessedItems,
  brandExtra,
  onBrandEdited,
  onGenerateSku,
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

  // Props every required control takes after the cell's own: the control
  // class plus the empty-field class (the cell's --warning rule keys on it),
  // and aria-required. The class stays on the control; the CSS draws the
  // marker on its cell.
  const rq = (c: FieldCellControlProps, value?: unknown) => ({
    className: `${c.className}${req(value)}`,
    'aria-required': true as const,
  });

  // A required field's label: the text, then a red asterisk (decorative) and
  // a visually hidden " (required)" so the accessible name says it in words.
  // Shown whether or not the field is filled; the empty state is the rule.
  const reqLabel = (text: string) => (
    <>
      {text}
      <span className="field-required-star" aria-hidden="true">*</span>
      <span className="ui-sr-only"> (required)</span>
    </>
  );

  // The preset's measurement template marks which measurements this category
  // expects (the checkbox grid in the Presets manager). Flagged-and-empty gets
  // a "needed" badge so the seller knows what to measure; nothing is hidden.
  const measurementTemplate = currentItem._presetData?.measurementTemplate as
    | Record<string, boolean>
    | undefined;

  // A measurement's meta: the preset's "Needed" badge when the template flags
  // it and it is empty, otherwise nothing (the asterisk is on the label).
  const measurementNeeded = (field: string, value?: string) => {
    if (!measurementTemplate?.[field] || value) return null;
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
          <FieldCell label={reqLabel("Price ($)")}>
            {(c) => <input {...c} type="number" value={currentItem.price || ''} onChange={(e) => updateGroupField('price', e.target.value ? parseFloat(e.target.value) : undefined)} placeholder="e.g., 49.99" {...rq(c, currentItem.price)} step="0.01" min="0" />}
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
          <FieldCell label={reqLabel("Brand")} meta={presetBadge('brand')} footer={brandExtra}>
            {(c) => <input {...c} type="text" value={currentItem.brand || ''} onChange={(e) => updateGroupField('brand', e.target.value)} onBlur={(e) => onBrandEdited?.(e.target.value)} placeholder="e.g., Nike, Levi's" {...rq(c, currentItem.brand)} />}
          </FieldCell>
          <FieldCell label={reqLabel("Size")}>
            {(c) => <input {...c} type="text" value={currentItem.size || ''} onChange={(e) => updateGroupField('size', e.target.value)} onBlur={(e) => { const norm = normalizeSizeValue(e.target.value, { keepFitsLike: true }); if (norm && norm !== e.target.value) updateGroupField('size', norm); }} placeholder="M, 1X, 32x34, YM, PS" {...rq(c, currentItem.size)} />}
          </FieldCell>
          <FieldCell label={reqLabel("Condition")}>
            {(c) => (
            <select {...c} value={currentItem.condition || ''} onChange={(e) => updateGroupField('condition', e.target.value)} {...rq(c, currentItem.condition)}>
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
          <FieldCell label={reqLabel("Color")}>
            {(c) => <input {...c} type="text" value={currentItem.color || ''} onChange={(e) => updateGroupField('color', e.target.value)} placeholder="e.g., Black, Blue" {...rq(c, currentItem.color)} />}
          </FieldCell>
          <FieldCell label="Secondary color">
            {(c) => <input {...c} type="text" value={currentItem.secondaryColor || ''} onChange={(e) => updateGroupField('secondaryColor', e.target.value)} placeholder="Additional color" />}
          </FieldCell>
          <FieldCell label={reqLabel("Material")} meta={presetBadge('material')}>
            {(c) => <input {...c} type="text" value={currentItem.material || ''} onChange={(e) => updateGroupField('material', e.target.value)} placeholder="e.g., 100% Cotton" {...rq(c, currentItem.material)} />}
          </FieldCell>
          <FieldCell label={reqLabel("Era or vibe")}>
            {(c) => <input {...c} type="text" value={currentItem.era || ''} onChange={(e) => updateGroupField('era', e.target.value)} placeholder="e.g., 90s, Y2K, vintage" {...rq(c, currentItem.era)} />}
          </FieldCell>
          <FieldCell label={reqLabel("Style")} meta={presetBadge('style')}>
            {(c) => <input {...c} type="text" value={currentItem.style || ''} onChange={(e) => updateGroupField('style', e.target.value)} placeholder="e.g., Streetwear, Preppy" {...rq(c, currentItem.style)} />}
          </FieldCell>
          <FieldCell label={reqLabel("Gender")} meta={presetBadge('gender')}>
            {(c) => (
            <select {...c} value={currentItem.gender || ''} onChange={(e) => updateGroupField('gender', e.target.value)} {...rq(c, currentItem.gender)}>
              <option value="">Select gender...</option>
              <option value="Men">Men</option>
              <option value="Women">Women</option>
              <option value="Unisex">Unisex</option>
              <option value="Kids">Kids</option>
            </select>
            )}
          </FieldCell>
          <FieldCell label={reqLabel("Type (garment)")} meta={presetBadge('productType')}>
            {(c) => <input {...c} type="text" value={currentItem.productType || ''} onChange={(e) => updateGroupField('productType', e.target.value)} placeholder="e.g., Sweater, Hoodie, Pants" {...rq(c, currentItem.productType)} />}
          </FieldCell>
          <FieldCell label={reqLabel("Model name")}>
            {(c) => <input {...c} type="text" value={currentItem.modelName || ''} onChange={(e) => updateGroupField('modelName', e.target.value)} placeholder="e.g., Air Force 1, 501" {...rq(c, currentItem.modelName)} />}
          </FieldCell>
          <FieldCell label={reqLabel("Flaws (if any)")}>
            {(c) => <input {...c} type="text" value={currentItem.flaws || ''} onChange={(e) => updateGroupField('flaws', e.target.value)} placeholder="e.g., minor pilling" {...rq(c, currentItem.flaws)} />}
          </FieldCell>
          <FieldCell label={reqLabel("Tags (comma-separated)")} meta={presetBadge('tags')}>
            {(c) => <input {...c} type="text" value={currentItem.tags?.join(', ') || ''} onChange={(e) => updateGroupField('tags', e.target.value ? e.target.value.split(',').map(t => t.trim()).filter(t => t) : [])} placeholder="e.g., vintage, tees, black" {...rq(c, currentItem.tags?.length)} />}
          </FieldCell>
          <FieldCell label={reqLabel("SEO title")}>
            {(c) => <input {...c} type="text" value={currentItem.seoTitle || ''} onChange={(e) => updateGroupField('seoTitle', e.target.value)} placeholder="e.g., Vintage Black Rolling Stones Tee" {...rq(c, currentItem.seoTitle)} />}
          </FieldCell>
          <FieldCell label={reqLabel("Care instructions")} meta={presetBadge('care')}>
            {(c) => <input {...c} type="text" value={currentItem.care || ''} onChange={(e) => updateGroupField('care', e.target.value)} placeholder="e.g., Machine wash cold" {...rq(c, currentItem.care)} />}
          </FieldCell>
        </FieldGrid>
      </FieldGroup>

      <FieldGroup caption="Measurements (inches)" data-section="measurements">
        <FieldGrid columns={3}>
          <FieldCell label={reqLabel("Width")} meta={measurementNeeded('width', currentItem.measurements?.width)}>
            {(c) => <input {...c} type="text" value={currentItem.measurements?.width || ''} onChange={(e) => updateGroupField('measurements.width', e.target.value)} placeholder="e.g., 22" {...rq(c, currentItem.measurements?.width)} />}
          </FieldCell>
          <FieldCell label={reqLabel("Length")} meta={measurementNeeded('length', currentItem.measurements?.length)}>
            {(c) => <input {...c} type="text" value={currentItem.measurements?.length || ''} onChange={(e) => updateGroupField('measurements.length', e.target.value)} placeholder="e.g., 28" {...rq(c, currentItem.measurements?.length)} />}
          </FieldCell>
          <FieldCell label={reqLabel("Sleeve")} meta={measurementNeeded('sleeve', currentItem.measurements?.sleeve)}>
            {(c) => <input {...c} type="text" value={currentItem.measurements?.sleeve || ''} onChange={(e) => updateGroupField('measurements.sleeve', e.target.value)} placeholder="e.g., 24" {...rq(c, currentItem.measurements?.sleeve)} />}
          </FieldCell>
          <FieldCell label={reqLabel("Shoulder")} meta={measurementNeeded('shoulder', currentItem.measurements?.shoulder)}>
            {(c) => <input {...c} type="text" value={currentItem.measurements?.shoulder || ''} onChange={(e) => updateGroupField('measurements.shoulder', e.target.value)} placeholder="e.g., 18" {...rq(c, currentItem.measurements?.shoulder)} />}
          </FieldCell>
          <FieldCell label={reqLabel("Waist")} meta={measurementNeeded('waist', currentItem.measurements?.waist)}>
            {(c) => <input {...c} type="text" value={currentItem.measurements?.waist || ''} onChange={(e) => updateGroupField('measurements.waist', e.target.value)} placeholder="e.g., 32" {...rq(c, currentItem.measurements?.waist)} />}
          </FieldCell>
          <FieldCell label={reqLabel("Inseam")} meta={measurementNeeded('inseam', currentItem.measurements?.inseam)}>
            {(c) => <input {...c} type="text" value={currentItem.measurements?.inseam || ''} onChange={(e) => updateGroupField('measurements.inseam', e.target.value)} placeholder="e.g., 30" {...rq(c, currentItem.measurements?.inseam)} />}
          </FieldCell>
          <FieldCell label={reqLabel("Rise")} meta={measurementNeeded('rise', currentItem.measurements?.rise)}>
            {(c) => <input {...c} type="text" value={currentItem.measurements?.rise || ''} onChange={(e) => updateGroupField('measurements.rise', e.target.value)} placeholder="e.g., 11" {...rq(c, currentItem.measurements?.rise)} />}
          </FieldCell>
        </FieldGrid>
      </FieldGroup>

      <FieldGroup caption="Inventory and shipping" data-section="inventory">
        <FieldGrid columns={3}>
          <FieldCell
            label={reqLabel("SKU")}
            meta={onGenerateSku && !(currentItem.sku || '').trim()
              ? <Button variant="ghost" size="sm" className="cpf-generate-sku" onClick={onGenerateSku}>Generate</Button>
              : undefined}
          >
            {(c) => <input {...c} type="text" value={currentItem.sku || ''} onChange={(e) => updateGroupField('sku', e.target.value)} placeholder="Stock keeping unit" {...rq(c, currentItem.sku)} />}
          </FieldCell>
          <FieldCell label="Inventory quantity">
            {(c) => <input {...c} type="number" value={currentItem.inventoryQuantity || ''} onChange={(e) => updateGroupField('inventoryQuantity', e.target.value ? parseInt(e.target.value) : undefined)} placeholder="Stock level" min="0" />}
          </FieldCell>
          <FieldCell label={reqLabel("Weight (grams)")} meta={presetBadge('weightValue')}>
            {(c) => <input {...c} type="text" value={currentItem.weightValue || ''} onChange={(e) => updateGroupField('weightValue', e.target.value)} placeholder="e.g., 350" {...rq(c, currentItem.weightValue)} />}
          </FieldCell>
          <FieldCell label={reqLabel("Ships from")} meta={presetBadge('shipsFrom')}>
            {(c) => <input {...c} type="text" value={currentItem.shipsFrom || ''} onChange={(e) => updateGroupField('shipsFrom', e.target.value)} placeholder="Shipping location" {...rq(c, currentItem.shipsFrom)} />}
          </FieldCell>
          <FieldCell label={reqLabel("Parcel size")} meta={presetBadge('parcelSize')}>
            {(c) => (
            <select {...c} value={currentItem.parcelSize || ''} onChange={(e) => updateGroupField('parcelSize', e.target.value)} {...rq(c, currentItem.parcelSize)}>
              <option value="">Select size...</option>
              <option value="Small">Small</option>
              <option value="Medium">Medium</option>
              <option value="Large">Large</option>
              <option value="Extra Large">Extra Large</option>
            </select>
            )}
          </FieldCell>
          <FieldCell label={reqLabel("Package dimensions")} meta={presetBadge('packageDimensions')}>
            {(c) => <input {...c} type="text" value={currentItem.packageDimensions || ''} onChange={(e) => updateGroupField('packageDimensions', e.target.value)} placeholder="e.g., 14 x 10 x 1 in" {...rq(c, currentItem.packageDimensions)} />}
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
          <FieldCell label={reqLabel("Age group")} meta={presetBadge('ageGroup')}>
            {(c) => <input {...c} type="text" value={currentItem.ageGroup || ''} onChange={(e) => updateGroupField('ageGroup', e.target.value)} placeholder="e.g., Adult (13+ years)" {...rq(c, currentItem.ageGroup)} />}
          </FieldCell>
          <FieldCell label={reqLabel("SEO description")} span={2}>
            {(c) => <textarea {...c} value={currentItem.seoDescription || ''} onChange={(e) => updateGroupField('seoDescription', e.target.value)} placeholder="Meta description for search engines" className={`${c.className} js-autogrow${req(currentItem.seoDescription)}`} aria-required="true" rows={2} />}
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


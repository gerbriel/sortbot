import { useState, useEffect } from 'react';
import type { CategoryPreset, CategoryPresetInput } from '../lib/categoryPresets';
import { DEFAULT_MEASUREMENT_TEMPLATES } from '../lib/categoryPresets';
import {
  getCategoryPresets,
  createCategoryPreset,
  updateCategoryPreset,
  deleteCategoryPreset,
} from '../lib/categoryPresetsService';
import { getCategories } from '../lib/categoriesService';
import type { Category } from '../lib/categories';
import './CategoryPresetsManager.css';

interface CategoryPresetsManagerProps {
  onClose: () => void;
}

const CategoryPresetsManager: React.FC<CategoryPresetsManagerProps> = ({ onClose }) => {
  const [presets, setPresets] = useState<CategoryPreset[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingPreset, setEditingPreset] = useState<CategoryPreset | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState<Partial<CategoryPresetInput>>({
    default_weight_unit: 'lb',
    requires_shipping: true,
    is_active: true,
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [presetsData, categoriesData] = await Promise.all([
        getCategoryPresets(),
        getCategories()
      ]);
      setPresets(presetsData);
      setCategories(categoriesData);
    } catch (error) {
      console.error('Error loading data:', error);
      alert('Failed to load category presets');
    } finally {
      setLoading(false);
    }
  };

  const loadPresets = async () => {
    try {
      setLoading(true);
      const data = await getCategoryPresets();
      setPresets(data);
    } catch (error) {
      console.error('Error loading presets:', error);
      alert('Failed to load category presets');
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = () => {
    setEditingPreset(null);
    setFormData({
      default_weight_unit: 'lb',
      requires_shipping: true,
      is_active: true,
      measurement_template: {
        pitToPit: false,
        length: false,
        sleeve: false,
        shoulder: false,
        waist: false,
        inseam: false,
        rise: false,
      },
    });
    setShowForm(true);
  };

  const handleEdit = (preset: CategoryPreset) => {
    setEditingPreset(preset);
    setFormData({
      category_name: preset.category_name,
      display_name: preset.display_name,
      description: preset.description,
      default_weight_value: preset.default_weight_value,
      default_weight_unit: preset.default_weight_unit,
      requires_shipping: preset.requires_shipping,
      product_type: preset.product_type,
      vendor: preset.vendor,
      suggested_price_min: preset.suggested_price_min,
      suggested_price_max: preset.suggested_price_max,
      default_material: preset.default_material,
      default_care_instructions: preset.default_care_instructions,
      measurement_template: preset.measurement_template,
      seo_title_template: preset.seo_title_template,
      seo_keywords: preset.seo_keywords,
      shopify_product_type: preset.shopify_product_type,
      shopify_collection_id: preset.shopify_collection_id,
      default_tags: preset.default_tags,
      typical_condition: preset.typical_condition,
      is_active: preset.is_active,
      // New CSV fields
      package_dimensions: (preset as any).package_dimensions,
      parcel_size: (preset as any).parcel_size,
      ships_from: (preset as any).ships_from,
      continue_selling_out_of_stock: (preset as any).continue_selling_out_of_stock,
      size_type: (preset as any).size_type,
      style: (preset as any).style,
      gender: (preset as any).gender,
      age_group: (preset as any).age_group,
      policies: (preset as any).policies,
      renewal_options: (preset as any).renewal_options,
      who_made_it: (preset as any).who_made_it,
      what_is_it: (preset as any).what_is_it,
      listing_type: (preset as any).listing_type,
      discounted_shipping: (preset as any).discounted_shipping,
      custom_label_0: (preset as any).custom_label_0,
    });
    setShowForm(true);
  };

  const handleDelete = async (id: string, displayName: string) => {
    if (!confirm(`Are you sure you want to delete "${displayName}"?`)) {
      return;
    }

    try {
      await deleteCategoryPreset(id);
      await loadPresets();
      alert('Category preset deleted successfully');
    } catch (error) {
      console.error('Error deleting preset:', error);
      alert('Failed to delete category preset');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.category_name || !formData.display_name) {
      alert('Category name and display name are required');
      return;
    }

    try {
      if (editingPreset) {
        await updateCategoryPreset(editingPreset.id, formData);
        alert('Category preset updated successfully');
      } else {
        await createCategoryPreset(formData as CategoryPresetInput);
        alert('Category preset created successfully');
      }
      
      await loadPresets();
      setShowForm(false);
      setEditingPreset(null);
    } catch (error) {
      console.error('Error saving preset:', error);
      alert('Failed to save category preset');
    }
  };

  const handleMeasurementToggle = (field: string) => {
    setFormData(prev => ({
      ...prev,
      measurement_template: {
        ...prev.measurement_template!,
        [field]: !(prev.measurement_template as any)?.[field],
      },
    }));
  };

  const handleTagsChange = (value: string) => {
    const tags = value.split(',').map(t => t.trim()).filter(t => t);
    setFormData(prev => ({ ...prev, default_tags: tags }));
  };

  const handleKeywordsChange = (value: string) => {
    const keywords = value.split(',').map(k => k.trim()).filter(k => k);
    setFormData(prev => ({ ...prev, seo_keywords: keywords }));
  };

  const loadDefaultTemplate = (categoryName: string) => {
    const template = DEFAULT_MEASUREMENT_TEMPLATES[categoryName];
    if (template) {
      setFormData(prev => ({
        ...prev,
        measurement_template: template,
      }));
    }
  };

  if (loading) {
    return <div className="presets-manager"><p>Loading category presets...</p></div>;
  }

  return (
    <div className="presets-manager-overlay">
      <div className="presets-manager">
        <div className="presets-header">
          <h2>Category Presets Manager</h2>
          <div className="header-actions">
            <button className="button" onClick={handleCreate}>
              + Create New Preset
            </button>
            <button className="button-close" onClick={onClose} title="Close">
              ✕
            </button>
          </div>
        </div>

      {showForm && (
        <div className="preset-form-overlay">
          <div className="preset-form-modal">
            <h3>{editingPreset ? 'Edit' : 'Create'} Category Preset</h3>
            
            <form onSubmit={handleSubmit}>
              <div className="form-section">
                <h4>Basic Information</h4>
                
                <div className="form-group">
                  <label>Category Name *</label>
                  {editingPreset ? (
                    <input
                      type="text"
                      value={formData.category_name || ''}
                      disabled
                    />
                  ) : (
                    <select
                      value={formData.category_name || ''}
                      onChange={(e) => {
                        const selectedCategory = categories.find(c => c.name === e.target.value);
                        setFormData(prev => ({ 
                          ...prev, 
                          category_name: e.target.value,
                          display_name: selectedCategory?.display_name || e.target.value
                        }));
                      }}
                      required
                    >
                      <option value="">-- Select a Category --</option>
                      {categories.map(cat => (
                        <option key={cat.id} value={cat.name}>
                          {cat.emoji} {cat.display_name}
                        </option>
                      ))}
                    </select>
                  )}
                  <small>
                    {editingPreset 
                      ? 'Category cannot be changed after creation.'
                      : 'Select from your available categories. Manage categories in the navbar.'}
                  </small>
                </div>

                <div className="form-group">
                  <label>Display Name *</label>
                  <input
                    type="text"
                    value={formData.display_name || ''}
                    onChange={(e) => setFormData(prev => ({ ...prev, display_name: e.target.value }))}
                    placeholder="e.g., Sweatshirts & Hoodies"
                    required
                  />
                </div>

                <div className="form-group">
                  <label>Description</label>
                  <textarea
                    value={formData.description || ''}
                    onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                    placeholder="Optional description..."
                    rows={2}
                  />
                </div>
              </div>

              <div className="form-section">
                <h4>Shipping & Physical Attributes</h4>
                
                <div className="form-row">
                  <div className="form-group">
                    <label>Default Weight</label>
                    <input
                      type="text"
                      value={formData.default_weight_value || ''}
                      onChange={(e) => setFormData(prev => ({ ...prev, default_weight_value: e.target.value }))}
                      placeholder="e.g., 1.2"
                    />
                  </div>

                  <div className="form-group">
                    <label>Weight Unit</label>
                    <select
                      value={formData.default_weight_unit || 'lb'}
                      onChange={(e) => setFormData(prev => ({ ...prev, default_weight_unit: e.target.value as any }))}
                    >
                      <option value="lb">Pounds (lb)</option>
                      <option value="oz">Ounces (oz)</option>
                      <option value="kg">Kilograms (kg)</option>
                      <option value="g">Grams (g)</option>
                    </select>
                  </div>
                </div>

                <div className="form-group checkbox-group">
                  <label>
                    <input
                      type="checkbox"
                      checked={formData.requires_shipping ?? true}
                      onChange={(e) => setFormData(prev => ({ ...prev, requires_shipping: e.target.checked }))}
                    />
                    Requires Shipping
                  </label>
                </div>
              </div>

              <div className="form-section">
                <h4>Product Classification</h4>
                
                <div className="form-group">
                  <label>Product Type</label>
                  <input
                    type="text"
                    value={formData.product_type || ''}
                    onChange={(e) => setFormData(prev => ({ ...prev, product_type: e.target.value }))}
                    placeholder="e.g., Apparel, Accessories"
                  />
                </div>

                <div className="form-group">
                  <label>Default Vendor/Brand</label>
                  <input
                    type="text"
                    value={formData.vendor || ''}
                    onChange={(e) => setFormData(prev => ({ ...prev, vendor: e.target.value }))}
                    placeholder="Optional default vendor"
                  />
                </div>

                <div className="form-group">
                  <label>Shopify Product Type</label>
                  <input
                    type="text"
                    value={formData.shopify_product_type || ''}
                    onChange={(e) => setFormData(prev => ({ ...prev, shopify_product_type: e.target.value }))}
                    placeholder="For Shopify integration"
                  />
                </div>
              </div>

              <div className="form-section">
                <h4>Pricing Guidance</h4>
                
                <div className="form-row">
                  <div className="form-group">
                    <label>Suggested Min Price ($)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={formData.suggested_price_min || ''}
                      onChange={(e) => setFormData(prev => ({ ...prev, suggested_price_min: parseFloat(e.target.value) || undefined }))}
                      placeholder="e.g., 25.00"
                    />
                  </div>

                  <div className="form-group">
                    <label>Suggested Max Price ($)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={formData.suggested_price_max || ''}
                      onChange={(e) => setFormData(prev => ({ ...prev, suggested_price_max: parseFloat(e.target.value) || undefined }))}
                      placeholder="e.g., 75.00"
                    />
                  </div>
                </div>
              </div>

              <div className="form-section">
                <h4>Product Attributes</h4>
                
                <div className="form-group">
                  <label>Default Material</label>
                  <input
                    type="text"
                    value={formData.default_material || ''}
                    onChange={(e) => setFormData(prev => ({ ...prev, default_material: e.target.value }))}
                    placeholder="e.g., Cotton, Polyester"
                  />
                </div>

                <div className="form-group">
                  <label>Default Care Instructions</label>
                  <textarea
                    value={formData.default_care_instructions || ''}
                    onChange={(e) => setFormData(prev => ({ ...prev, default_care_instructions: e.target.value }))}
                    placeholder="e.g., Machine wash cold, tumble dry low"
                    rows={2}
                  />
                </div>

                <div className="form-group">
                  <label>Typical Condition</label>
                  <select
                    value={formData.typical_condition || ''}
                    onChange={(e) => setFormData(prev => ({ ...prev, typical_condition: e.target.value }))}
                  >
                    <option value="">None</option>
                    <option value="NWT">NWT (New With Tags)</option>
                    <option value="Like New">Like New</option>
                    <option value="Excellent">Excellent</option>
                    <option value="Good">Good</option>
                    <option value="Fair">Fair</option>
                  </select>
                </div>
              </div>

              <div className="form-section">
                <h4>Shipping & Packaging (CSV Export Fields)</h4>
                
                <div className="form-group">
                  <label>Package Dimensions</label>
                  <input
                    type="text"
                    value={(formData as any).package_dimensions || ''}
                    onChange={(e) => setFormData(prev => ({ ...prev, package_dimensions: e.target.value } as any))}
                    placeholder="e.g., 12 in - 10 in - 4 in"
                  />
                  <small>Format: Length x Width x Height</small>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Parcel Size</label>
                    <select
                      value={(formData as any).parcel_size || ''}
                      onChange={(e) => setFormData(prev => ({ ...prev, parcel_size: e.target.value } as any))}
                    >
                      <option value="">-- Select --</option>
                      <option value="Small">Small</option>
                      <option value="Medium">Medium</option>
                      <option value="Large">Large</option>
                      <option value="Extra Large">Extra Large</option>
                    </select>
                  </div>

                  <div className="form-group checkbox-group">
                    <label>
                      <input
                        type="checkbox"
                        checked={(formData as any).continue_selling_out_of_stock ?? false}
                        onChange={(e) => setFormData(prev => ({ ...prev, continue_selling_out_of_stock: e.target.checked } as any))}
                      />
                      Continue Selling Out of Stock
                    </label>
                  </div>
                </div>

                <div className="form-group">
                  <label>Ships From (Address)</label>
                  <input
                    type="text"
                    value={(formData as any).ships_from || ''}
                    onChange={(e) => setFormData(prev => ({ ...prev, ships_from: e.target.value } as any))}
                    placeholder="e.g., 601 W. Lincoln Ave, Fresno CA 93706"
                  />
                </div>
              </div>

              <div className="form-section">
                <h4>Product Classification (CSV Export Fields)</h4>
                
                <div className="form-row">
                  <div className="form-group">
                    <label>Size Type</label>
                    <select
                      value={(formData as any).size_type || ''}
                      onChange={(e) => setFormData(prev => ({ ...prev, size_type: e.target.value } as any))}
                    >
                      <option value="">-- Select --</option>
                      <option value="Regular">Regular</option>
                      <option value="Big & Tall">Big & Tall</option>
                      <option value="Petite">Petite</option>
                      <option value="Plus Size">Plus Size</option>
                      <option value="One Size">One Size</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label>Gender</label>
                    <select
                      value={(formData as any).gender || ''}
                      onChange={(e) => setFormData(prev => ({ ...prev, gender: e.target.value } as any))}
                    >
                      <option value="">-- Select --</option>
                      <option value="Men">Men</option>
                      <option value="Women">Women</option>
                      <option value="Unisex">Unisex</option>
                      <option value="Kids">Kids</option>
                    </select>
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Style</label>
                    <input
                      type="text"
                      value={(formData as any).style || ''}
                      onChange={(e) => setFormData(prev => ({ ...prev, style: e.target.value } as any))}
                      placeholder="e.g., Vintage, Modern, Streetwear"
                    />
                  </div>

                  <div className="form-group">
                    <label>Age Group</label>
                    <input
                      type="text"
                      value={(formData as any).age_group || ''}
                      onChange={(e) => setFormData(prev => ({ ...prev, age_group: e.target.value } as any))}
                      placeholder="e.g., Adult (13+ years old)"
                    />
                  </div>
                </div>
              </div>

              <div className="form-section">
                <h4>Policies & Marketplace (CSV Export Fields)</h4>
                
                <div className="form-group">
                  <label>Policies</label>
                  <input
                    type="text"
                    value={(formData as any).policies || ''}
                    onChange={(e) => setFormData(prev => ({ ...prev, policies: e.target.value } as any))}
                    placeholder="e.g., No Returns; No Exchanges"
                  />
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Who Made It</label>
                    <input
                      type="text"
                      value={(formData as any).who_made_it || ''}
                      onChange={(e) => setFormData(prev => ({ ...prev, who_made_it: e.target.value } as any))}
                      placeholder="e.g., Another Company Or Person"
                    />
                  </div>

                  <div className="form-group">
                    <label>What Is It</label>
                    <input
                      type="text"
                      value={(formData as any).what_is_it || ''}
                      onChange={(e) => setFormData(prev => ({ ...prev, what_is_it: e.target.value } as any))}
                      placeholder="e.g., A Finished Product"
                    />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Listing Type</label>
                    <input
                      type="text"
                      value={(formData as any).listing_type || ''}
                      onChange={(e) => setFormData(prev => ({ ...prev, listing_type: e.target.value } as any))}
                      placeholder="e.g., Physical Item"
                    />
                  </div>

                  <div className="form-group">
                    <label>Renewal Options</label>
                    <input
                      type="text"
                      value={(formData as any).renewal_options || ''}
                      onChange={(e) => setFormData(prev => ({ ...prev, renewal_options: e.target.value } as any))}
                      placeholder="e.g., Automatic"
                    />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Discounted Shipping</label>
                    <input
                      type="text"
                      value={(formData as any).discounted_shipping || ''}
                      onChange={(e) => setFormData(prev => ({ ...prev, discounted_shipping: e.target.value } as any))}
                      placeholder="e.g., No Discount, 10% Off"
                    />
                  </div>

                  <div className="form-group">
                    <label>Custom Label (Google Shopping)</label>
                    <input
                      type="text"
                      value={(formData as any).custom_label_0 || ''}
                      onChange={(e) => setFormData(prev => ({ ...prev, custom_label_0: e.target.value } as any))}
                      placeholder="e.g., Top Seller, New Arrival"
                    />
                  </div>
                </div>
              </div>

              <div className="form-section">
                <h4>Measurement Template</h4>
                <p className="form-hint">Select which measurements are relevant for this category</p>
                
                {formData.category_name && DEFAULT_MEASUREMENT_TEMPLATES[formData.category_name] && (
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => loadDefaultTemplate(formData.category_name!)}
                    style={{ marginBottom: '1rem' }}
                  >
                    Load Default Template for {formData.category_name}
                  </button>
                )}
                
                <div className="measurement-checkboxes">
                  {Object.keys(formData.measurement_template || {}).map((field) => (
                    <label key={field} className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={formData.measurement_template?.[field as keyof typeof formData.measurement_template] || false}
                        onChange={() => handleMeasurementToggle(field as any)}
                      />
                      {field.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}
                    </label>
                  ))}
                </div>
              </div>

              <div className="form-section">
                <h4>Tags & SEO</h4>
                
                <div className="form-group">
                  <label>Default Tags (comma-separated)</label>
                  <input
                    type="text"
                    value={formData.default_tags?.join(', ') || ''}
                    onChange={(e) => handleTagsChange(e.target.value)}
                    placeholder="e.g., sweatshirt, pullover, vintage"
                  />
                </div>

                <div className="form-group">
                  <label>SEO Keywords (comma-separated)</label>
                  <input
                    type="text"
                    value={formData.seo_keywords?.join(', ') || ''}
                    onChange={(e) => handleKeywordsChange(e.target.value)}
                    placeholder="e.g., vintage, retro, streetwear"
                  />
                </div>

                <div className="form-group">
                  <label>SEO Title Template</label>
                  <input
                    type="text"
                    value={formData.seo_title_template || ''}
                    onChange={(e) => setFormData(prev => ({ ...prev, seo_title_template: e.target.value }))}
                    placeholder="e.g., {size} {brand} {category} {color}"
                  />
                  <small>Use placeholders: {'{size}'}, {'{brand}'}, {'{category}'}, {'{color}'}, {'{era}'}</small>
                </div>
              </div>

              <div className="form-actions">
                <button type="button" className="button button-secondary" onClick={() => setShowForm(false)}>
                  Cancel
                </button>
                <button type="submit" className="button">
                  {editingPreset ? 'Update' : 'Create'} Preset
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="presets-grid">
        {presets.length === 0 ? (
          <div className="empty-state">
            <p>No category presets yet. Create your first preset to get started!</p>
          </div>
        ) : (
          presets.map((preset) => (
            <div key={preset.id} className="preset-card">
              <div className="preset-header">
                <h3>{preset.display_name}</h3>
                <span className="preset-category">{preset.category_name}</span>
              </div>
              
              {preset.description && (
                <p className="preset-description">{preset.description}</p>
              )}
              
              <div className="preset-details">
                {preset.default_weight_value && (
                  <div className="preset-detail">
                    <strong>Weight:</strong> {preset.default_weight_value} {preset.default_weight_unit}
                  </div>
                )}
                
                {preset.product_type && (
                  <div className="preset-detail">
                    <strong>Type:</strong> {preset.product_type}
                  </div>
                )}
                
                {preset.suggested_price_min && preset.suggested_price_max && (
                  <div className="preset-detail">
                    <strong>Price Range:</strong> ${preset.suggested_price_min} - ${preset.suggested_price_max}
                  </div>
                )}
                
                {preset.default_tags && preset.default_tags.length > 0 && (
                  <div className="preset-detail">
                    <strong>Tags:</strong> {preset.default_tags.join(', ')}
                  </div>
                )}
                
                <div className="preset-detail">
                  <strong>Measurements:</strong>{' '}
                  {Object.entries(preset.measurement_template)
                    .filter(([_, enabled]) => enabled)
                    .map(([key]) => key)
                    .join(', ') || 'None'}
                </div>
              </div>
              
              <div className="preset-actions">
                <button className="button button-secondary" onClick={() => handleEdit(preset)}>
                  Edit
                </button>
                <button 
                  className="button button-danger" 
                  onClick={() => handleDelete(preset.id, preset.display_name)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))
        )}
      </div>
      </div>
    </div>
  );
};

export default CategoryPresetsManager;

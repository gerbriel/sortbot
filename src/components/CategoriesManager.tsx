import { useState, useEffect } from 'react';
import type { Category, CategoryInput } from '../lib/categories';
import { 
  Shirt, 
  Wind, 
  User, 
  Package, 
  Box,
  ShoppingBag,
  Footprints,
  Glasses,
  Watch,
  Headphones,
  Briefcase,
  Heart,
  Star,
  Zap
} from 'lucide-react';
import {
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  reorderCategories,
  initializeDefaultCategories,
} from '../lib/categoriesService';
import './CategoriesManager.css';

// Icon options for categories
const ICON_OPTIONS = [
  { name: 'shirt', component: Shirt, label: 'Shirt' },
  { name: 'wind', component: Wind, label: 'Jacket/Outerwear' },
  { name: 'footprints', component: Footprints, label: 'Pants/Bottoms' },
  { name: 'user', component: User, label: 'Feminine' },
  { name: 'glasses', component: Glasses, label: 'Hat/Cap' },
  { name: 'box', component: Box, label: 'Mystery Box' },
  { name: 'package', component: Package, label: 'Package' },
  { name: 'shopping-bag', component: ShoppingBag, label: 'Shopping' },
  { name: 'watch', component: Watch, label: 'Accessories' },
  { name: 'headphones', component: Headphones, label: 'Electronics' },
  { name: 'briefcase', component: Briefcase, label: 'Professional' },
  { name: 'heart', component: Heart, label: 'Favorites' },
  { name: 'star', component: Star, label: 'Featured' },
  { name: 'zap', component: Zap, label: 'Special' },
];

// Helper to get icon component by name
const getIconComponent = (iconName: string | undefined, size: number = 20) => {
  const icon = ICON_OPTIONS.find(opt => opt.name === iconName);
  if (icon) {
    const IconComponent = icon.component;
    return <IconComponent size={size} />;
  }
  return <Package size={size} />; // Default
};

interface CategoriesManagerProps {
  onClose: () => void;
}

const CategoriesManager: React.FC<CategoriesManagerProps> = ({ onClose }) => {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState<Partial<CategoryInput>>({
    emoji: 'package', // Default icon name instead of emoji
    color: '#667eea',
  });

  useEffect(() => {
    loadCategories();
  }, []);

  const loadCategories = async () => {
    try {
      setLoading(true);
      
      // First, try to get categories
      let data = await getCategories();
      
      // If no categories exist, initialize default ones
      if (!data || data.length === 0) {
        console.log('No categories found, initializing defaults...');
        await initializeDefaultCategories();
        // Fetch again after initialization
        data = await getCategories();
      }
      
      setCategories(data);
    } catch (error) {
      console.error('Failed to load categories:', error);
      alert('Failed to load categories. Check console for details.');
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = () => {
    setEditingCategory(null);
    setFormData({
      emoji: '📦',
      color: '#667eea',
    });
    setShowForm(true);
  };

  const handleEdit = (category: Category) => {
    setEditingCategory(category);
    setFormData({
      name: category.name,
      display_name: category.display_name,
      emoji: category.emoji,
      color: category.color,
      sort_order: category.sort_order,
    });
    setShowForm(true);
  };

  const handleDelete = async (id: string, displayName: string) => {
    if (!confirm(`Are you sure you want to delete "${displayName}"? This cannot be undone.`)) {
      return;
    }

    try {
      await deleteCategory(id);
      await loadCategories();
      
      // Notify other components that categories changed
      window.dispatchEvent(new CustomEvent('categoriesUpdated'));
    } catch (error) {
      console.error('Failed to delete category:', error);
      alert('Failed to delete category');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name || !formData.display_name) {
      alert('Please fill in all required fields');
      return;
    }

    try {
      if (editingCategory) {
        await updateCategory(editingCategory.id, formData);
      } else {
        await createCategory(formData as CategoryInput);
      }
      
      await loadCategories();
      setShowForm(false);
      setFormData({ emoji: '📦', color: '#667eea' });
      
      // Notify other components that categories changed
      window.dispatchEvent(new CustomEvent('categoriesUpdated'));
    } catch (error) {
      console.error('Failed to save category:', error);
      alert('Failed to save category. Make sure the category name is unique.');
    }
  };

  const handleMoveUp = async (index: number) => {
    if (index === 0) return;
    
    const newOrder = [...categories];
    [newOrder[index - 1], newOrder[index]] = [newOrder[index], newOrder[index - 1]];
    
    setCategories(newOrder);
    await reorderCategories(newOrder.map(c => c.id));
    
    // Notify other components that categories changed
    window.dispatchEvent(new CustomEvent('categoriesUpdated'));
  };

  const handleMoveDown = async (index: number) => {
    if (index === categories.length - 1) return;
    
    const newOrder = [...categories];
    [newOrder[index], newOrder[index + 1]] = [newOrder[index + 1], newOrder[index]];
    
    setCategories(newOrder);
    await reorderCategories(newOrder.map(c => c.id));
    
    // Notify other components that categories changed
    window.dispatchEvent(new CustomEvent('categoriesUpdated'));
  };

  if (loading) {
    return (
      <div className="categories-manager-overlay">
        <div className="categories-manager">
          <p>Loading categories...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="categories-manager-overlay">
      <div className="categories-manager">
        <div className="categories-header">
          <h2>Manage Categories</h2>
          <div className="header-actions">
            <button className="button" onClick={handleCreate}>
              + Add Category
            </button>
            <button className="button-close" onClick={onClose} title="Close">
              ✕
            </button>
          </div>
        </div>

        {showForm && (
          <div className="category-form-overlay">
            <div className="category-form-modal">
              <h3>{editingCategory ? 'Edit' : 'Create'} Category</h3>
              
              <form onSubmit={handleSubmit}>
                <div className="form-group">
                  <label>Internal Name (lowercase, no spaces) *</label>
                  <input
                    type="text"
                    value={formData.name || ''}
                    onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="e.g., sweatshirts"
                    required
                    disabled={!!editingCategory}
                  />
                  <small>Used internally. Cannot be changed after creation.</small>
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
                  <label>Icon</label>
                  <div className="emoji-picker">
                    {ICON_OPTIONS.map(option => {
                      const IconComponent = option.component;
                      return (
                        <button
                          key={option.name}
                          type="button"
                          className={`emoji-option ${formData.emoji === option.name ? 'selected' : ''}`}
                          onClick={() => setFormData(prev => ({ ...prev, emoji: option.name }))}
                          title={option.label}
                        >
                          <IconComponent size={24} />
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="form-group">
                  <label>Color</label>
                  <input
                    type="color"
                    value={formData.color || '#667eea'}
                    onChange={(e) => setFormData(prev => ({ ...prev, color: e.target.value }))}
                  />
                </div>

                <div className="form-actions">
                  <button type="submit" className="button button-primary">
                    {editingCategory ? 'Update' : 'Create'} Category
                  </button>
                  <button type="button" className="button" onClick={() => setShowForm(false)}>
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        <div className="categories-list">
          {categories.length === 0 ? (
            <div className="empty-state">
              <p>No categories yet. Create your first category!</p>
            </div>
          ) : (
            categories.map((category, index) => (
              <div key={category.id} className="category-item">
                <div className="category-info">
                  <span className="category-emoji" style={{ backgroundColor: category.color }}>
                    {getIconComponent(category.emoji, 24)}
                  </span>
                  <div className="category-details">
                    <strong>{category.display_name}</strong>
                    <small>{category.name}</small>
                  </div>
                </div>
                <div className="category-actions">
                  <button
                    className="button-icon"
                    onClick={() => handleMoveUp(index)}
                    disabled={index === 0}
                    title="Move up"
                  >
                    ↑
                  </button>
                  <button
                    className="button-icon"
                    onClick={() => handleMoveDown(index)}
                    disabled={index === categories.length - 1}
                    title="Move down"
                  >
                    ↓
                  </button>
                  <button
                    className="button button-small"
                    onClick={() => handleEdit(category)}
                  >
                    Edit
                  </button>
                  <button
                    className="button button-danger button-small"
                    onClick={() => handleDelete(category.id, category.display_name)}
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

export default CategoriesManager;

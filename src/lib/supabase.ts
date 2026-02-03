import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables. Please check your .env file.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Database types
export interface Database {
  public: {
    Tables: {
      products: {
        Row: {
          id: string;
          user_id: string;
          title: string | null;
          url_handle: string | null;
          description: string | null;
          vendor: string | null;
          product_category: string | null;
          product_type: string | null;
          tags: string[] | null;
          published: boolean;
          status: string;
          size: string | null;
          color: string | null;
          price: number | null;
          compare_at_price: number | null;
          cost_per_item: number | null;
          sku: string | null;
          barcode: string | null;
          inventory_quantity: number;
          weight_value: string | null;
          weight_unit: string;
          requires_shipping: boolean;
          condition: string | null;
          flaws: string | null;
          material: string | null;
          era: string | null;
          care_instructions: string | null;
          measurements: any;
          seo_title: string | null;
          seo_description: string | null;
          voice_description: string | null;
          created_at: string;
          updated_at: string;
          exported_at: string | null;
        };
        Insert: Omit<Database['public']['Tables']['products']['Row'], 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Database['public']['Tables']['products']['Insert']>;
      };
      product_images: {
        Row: {
          id: string;
          product_id: string;
          user_id: string;
          image_url: string;
          storage_path: string;
          position: number;
          alt_text: string | null;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['product_images']['Row'], 'id' | 'created_at'>;
        Update: Partial<Database['public']['Tables']['product_images']['Insert']>;
      };
    };
  };
}

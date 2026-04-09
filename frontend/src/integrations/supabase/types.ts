export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      chart_of_accounts: {
        Row: {
          account_type: string
          code: string
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          parent_id: string | null
          updated_at: string
        }
        Insert: {
          account_type: string
          code: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          parent_id?: string | null
          updated_at?: string
        }
        Update: {
          account_type?: string
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          parent_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chart_of_accounts_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      fiscal_periods: {
        Row: {
          created_at: string
          end_date: string
          id: string
          name: string
          start_date: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          end_date: string
          id?: string
          name: string
          start_date: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          end_date?: string
          id?: string
          name?: string
          start_date?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      goods_receipts: {
        Row: {
          created_at: string
          id: string
          notes: string | null
          po_id: string
          received_at: string
          received_by: string
        }
        Insert: {
          created_at?: string
          id?: string
          notes?: string | null
          po_id: string
          received_at?: string
          received_by: string
        }
        Update: {
          created_at?: string
          id?: string
          notes?: string | null
          po_id?: string
          received_at?: string
          received_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "goods_receipts_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      gr_line_items: {
        Row: {
          created_at: string
          id: string
          item_id: string | null
          quantity_received: number
          quantity_rejected: number | null
          receipt_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          item_id?: string | null
          quantity_received: number
          quantity_rejected?: number | null
          receipt_id: string
        }
        Update: {
          created_at?: string
          id?: string
          item_id?: string | null
          quantity_received?: number
          quantity_rejected?: number | null
          receipt_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gr_line_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "stock_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gr_line_items_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "goods_receipts"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          is_read: boolean
          link: string | null
          message: string | null
          module: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_read?: boolean
          link?: string | null
          message?: string | null
          module?: string | null
          title: string
          type?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_read?: boolean
          link?: string | null
          message?: string | null
          module?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      outlets: {
        Row: {
          address: string | null
          created_at: string
          id: string
          name: string
          region: string | null
          status: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          id?: string
          name: string
          region?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          created_at?: string
          id?: string
          name?: string
          region?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      payments: {
        Row: {
          amount: number
          created_at: string
          id: string
          method: string
          order_id: string
          reference: string | null
          status: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          method?: string
          order_id: string
          reference?: string | null
          status?: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          method?: string
          order_id?: string
          reference?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_periods: {
        Row: {
          created_at: string
          created_by: string | null
          end_date: string
          id: string
          period_name: string
          start_date: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          end_date: string
          id?: string
          period_name: string
          start_date: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          end_date?: string
          id?: string
          period_name?: string
          start_date?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      payslips: {
        Row: {
          allowances: number
          basic_salary: number
          created_at: string
          deductions: number
          employee_id: string
          gross_pay: number
          id: string
          net_pay: number
          notes: string | null
          overtime: number
          period_id: string
          status: string
          tax: number
          updated_at: string
        }
        Insert: {
          allowances?: number
          basic_salary?: number
          created_at?: string
          deductions?: number
          employee_id: string
          gross_pay?: number
          id?: string
          net_pay?: number
          notes?: string | null
          overtime?: number
          period_id: string
          status?: string
          tax?: number
          updated_at?: string
        }
        Update: {
          allowances?: number
          basic_salary?: number
          created_at?: string
          deductions?: number
          employee_id?: string
          gross_pay?: number
          id?: string
          net_pay?: number
          notes?: string | null
          overtime?: number
          period_id?: string
          status?: string
          tax?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payslips_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "payroll_periods"
            referencedColumns: ["id"]
          },
        ]
      }
      po_line_items: {
        Row: {
          created_at: string
          description: string
          id: string
          item_id: string | null
          line_total: number
          po_id: string
          quantity: number
          unit_price: number
        }
        Insert: {
          created_at?: string
          description: string
          id?: string
          item_id?: string | null
          line_total: number
          po_id: string
          quantity: number
          unit_price: number
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          item_id?: string | null
          line_total?: number
          po_id?: string
          quantity?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "po_line_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "stock_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "po_line_items_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_sessions: {
        Row: {
          closed_at: string | null
          closing_cash: number | null
          created_at: string
          id: string
          notes: string | null
          opened_at: string
          opening_float: number
          operator_id: string
          outlet_id: string
          status: string
          updated_at: string
        }
        Insert: {
          closed_at?: string | null
          closing_cash?: number | null
          created_at?: string
          id?: string
          notes?: string | null
          opened_at?: string
          opening_float?: number
          operator_id: string
          outlet_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          closed_at?: string | null
          closing_cash?: number | null
          created_at?: string
          id?: string
          notes?: string | null
          opened_at?: string
          opening_float?: number
          operator_id?: string
          outlet_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pos_sessions_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          persona: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          persona?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          persona?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      purchase_orders: {
        Row: {
          approved_by: string | null
          created_at: string
          created_by: string
          id: string
          notes: string | null
          outlet_id: string | null
          po_number: string
          status: string
          supplier_id: string
          total: number
          updated_at: string
        }
        Insert: {
          approved_by?: string | null
          created_at?: string
          created_by: string
          id?: string
          notes?: string | null
          outlet_id?: string | null
          po_number: string
          status?: string
          supplier_id: string
          total?: number
          updated_at?: string
        }
        Update: {
          approved_by?: string | null
          created_at?: string
          created_by?: string
          id?: string
          notes?: string | null
          outlet_id?: string | null
          po_number?: string
          status?: string
          supplier_id?: string
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_order_items: {
        Row: {
          created_at: string
          id: string
          line_total: number
          notes: string | null
          order_id: string
          product_name: string
          quantity: number
          sku: string | null
          unit_price: number
        }
        Insert: {
          created_at?: string
          id?: string
          line_total: number
          notes?: string | null
          order_id: string
          product_name: string
          quantity?: number
          sku?: string | null
          unit_price: number
        }
        Update: {
          created_at?: string
          id?: string
          line_total?: number
          notes?: string | null
          order_id?: string
          product_name?: string
          quantity?: number
          sku?: string | null
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "sale_order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_orders: {
        Row: {
          created_at: string
          created_by: string | null
          customer_name: string | null
          customer_phone: string | null
          discount: number
          id: string
          order_number: string
          order_type: string | null
          session_id: string
          status: string
          subtotal: number
          table_number: string | null
          tax: number
          total: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          discount?: number
          id?: string
          order_number: string
          order_type?: string | null
          session_id: string
          status?: string
          subtotal?: number
          table_number?: string | null
          tax?: number
          total?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          discount?: number
          id?: string
          order_number?: string
          order_type?: string | null
          session_id?: string
          status?: string
          subtotal?: number
          table_number?: string | null
          tax?: number
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sale_orders_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "pos_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_adjustments: {
        Row: {
          adjusted_by: string
          adjustment_type: string
          created_at: string
          id: string
          item_id: string
          outlet_id: string
          quantity: number
          reason: string | null
        }
        Insert: {
          adjusted_by: string
          adjustment_type: string
          created_at?: string
          id?: string
          item_id: string
          outlet_id: string
          quantity: number
          reason?: string | null
        }
        Update: {
          adjusted_by?: string
          adjustment_type?: string
          created_at?: string
          id?: string
          item_id?: string
          outlet_id?: string
          quantity?: number
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_adjustments_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "stock_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_adjustments_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_balances: {
        Row: {
          id: string
          item_id: string
          last_counted_at: string | null
          outlet_id: string
          quantity: number
          updated_at: string
        }
        Insert: {
          id?: string
          item_id: string
          last_counted_at?: string | null
          outlet_id: string
          quantity?: number
          updated_at?: string
        }
        Update: {
          id?: string
          item_id?: string
          last_counted_at?: string | null
          outlet_id?: string
          quantity?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_balances_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "stock_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_balances_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_items: {
        Row: {
          category: string | null
          created_at: string
          id: string
          name: string
          reorder_level: number | null
          sku: string
          unit: string
          updated_at: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          id?: string
          name: string
          reorder_level?: number | null
          sku: string
          unit?: string
          updated_at?: string
        }
        Update: {
          category?: string | null
          created_at?: string
          id?: string
          name?: string
          reorder_level?: number | null
          sku?: string
          unit?: string
          updated_at?: string
        }
        Relationships: []
      }
      supplier_invoices: {
        Row: {
          created_at: string
          created_by: string | null
          due_date: string | null
          id: string
          invoice_number: string
          notes: string | null
          po_id: string | null
          status: string
          supplier_id: string
          tax: number | null
          total: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          id?: string
          invoice_number: string
          notes?: string | null
          po_id?: string | null
          status?: string
          supplier_id: string
          tax?: number | null
          total: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          id?: string
          invoice_number?: string
          notes?: string | null
          po_id?: string | null
          status?: string
          supplier_id?: string
          tax?: number | null
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_invoices_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_invoices_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_payments: {
        Row: {
          amount: number
          approved_by: string | null
          created_at: string
          id: string
          invoice_id: string
          method: string
          notes: string | null
          reference: string | null
          status: string
          updated_at: string
        }
        Insert: {
          amount: number
          approved_by?: string | null
          created_at?: string
          id?: string
          invoice_id: string
          method?: string
          notes?: string | null
          reference?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          approved_by?: string | null
          created_at?: string
          id?: string
          invoice_id?: string
          method?: string
          notes?: string | null
          reference?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "supplier_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          address: string | null
          contact_person: string | null
          created_at: string
          email: string | null
          id: string
          name: string
          phone: string | null
          status: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          contact_person?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name: string
          phone?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          contact_person?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          phone?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      tax_configs: {
        Row: {
          bracket_max: number | null
          bracket_min: number | null
          created_at: string
          effective_from: string
          id: string
          is_active: boolean
          name: string
          rate: number
        }
        Insert: {
          bracket_max?: number | null
          bracket_min?: number | null
          created_at?: string
          effective_from?: string
          id?: string
          is_active?: boolean
          name: string
          rate: number
        }
        Update: {
          bracket_max?: number | null
          bracket_min?: number | null
          created_at?: string
          effective_from?: string
          id?: string
          is_active?: boolean
          name?: string
          rate?: number
        }
        Relationships: []
      }
      tax_rates: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          is_default: boolean
          name: string
          rate: number
          type: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          name: string
          rate: number
          type?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          name?: string
          rate?: number
          type?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      waste_records: {
        Row: {
          created_at: string
          id: string
          item_id: string
          outlet_id: string
          quantity: number
          reason: string | null
          recorded_by: string
        }
        Insert: {
          created_at?: string
          id?: string
          item_id: string
          outlet_id: string
          quantity: number
          reason?: string | null
          recorded_by: string
        }
        Update: {
          created_at?: string
          id?: string
          item_id?: string
          outlet_id?: string
          quantity?: number
          reason?: string | null
          recorded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "waste_records_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "stock_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waste_records_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "manager" | "operator" | "viewer"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "manager", "operator", "viewer"],
    },
  },
} as const

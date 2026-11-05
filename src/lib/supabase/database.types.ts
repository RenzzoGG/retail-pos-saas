
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "activity_log": {
                  Row: {
                    "action": Database["public"]['Enums']["activity_action"],"actor_id": string | null,"after": Json | null,"before": Json | null,"created_at": string,"id": number,"record_id": string,"store_id": string | null,"table_name": string
                  }
                  ComputedFields: never
                  Insert: {
                    "action": Database["public"]['Enums']["activity_action"],"actor_id"?: string | null,"after"?: Json | null,"before"?: Json | null,"created_at"?: string,"id"?: never,"record_id": string,"store_id"?: string | null,"table_name": string
                  }
                  Update: {
                    "action"?: Database["public"]['Enums']["activity_action"],"actor_id"?: string | null,"after"?: Json | null,"before"?: Json | null,"created_at"?: string,"id"?: never,"record_id"?: string,"store_id"?: string | null,"table_name"?: string
                  }
                  Relationships: [
                    
                  ]
                },"customers": {
                  Row: {
                    "created_at": string,"created_by": string | null,"document_id": string | null,"email": string | null,"id": string,"name": string,"notes": string | null,"phone": string | null,"store_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"document_id"?: string | null,"email"?: string | null,"id"?: string,"name": string,"notes"?: string | null,"phone"?: string | null,"store_id": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"document_id"?: string | null,"email"?: string | null,"id"?: string,"name"?: string,"notes"?: string | null,"phone"?: string | null,"store_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "customers_store_id_stores_id_fk"
      columns: ["store_id"]
isOneToOne: false
      referencedRelation: "stores"
      referencedColumns: ["id"]
    }
                  ]
                },"import_batches": {
                  Row: {
                    "created_at": string,"created_by": string | null,"created_count": number,"file_name": string,"id": string,"skipped_count": number,"stock_entry_id": string | null,"store_id": string,"total_rows": number,"update_existing": boolean,"updated_count": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"created_count": number,"file_name": string,"id"?: string,"skipped_count": number,"stock_entry_id"?: string | null,"store_id": string,"total_rows": number,"update_existing"?: boolean,"updated_count": number
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"created_count"?: number,"file_name"?: string,"id"?: string,"skipped_count"?: number,"stock_entry_id"?: string | null,"store_id"?: string,"total_rows"?: number,"update_existing"?: boolean,"updated_count"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "import_batches_stock_entry_fk"
      columns: ["stock_entry_id","store_id"]
isOneToOne: false
      referencedRelation: "stock_entries"
      referencedColumns: ["id","store_id"]
    },{
      foreignKeyName: "import_batches_store_id_stores_id_fk"
      columns: ["store_id"]
isOneToOne: false
      referencedRelation: "stores"
      referencedColumns: ["id"]
    }
                  ]
                },"invitations": {
                  Row: {
                    "accepted_at": string | null,"accepted_by": string | null,"created_at": string,"email": string,"expires_at": string,"id": string,"invited_by": string | null,"role": Database["public"]['Enums']["store_role"],"store_id": string,"token_hash": string
                  }
                  ComputedFields: never
                  Insert: {
                    "accepted_at"?: string | null,"accepted_by"?: string | null,"created_at"?: string,"email": string,"expires_at": string,"id"?: string,"invited_by"?: string | null,"role": Database["public"]['Enums']["store_role"],"store_id": string,"token_hash": string
                  }
                  Update: {
                    "accepted_at"?: string | null,"accepted_by"?: string | null,"created_at"?: string,"email"?: string,"expires_at"?: string,"id"?: string,"invited_by"?: string | null,"role"?: Database["public"]['Enums']["store_role"],"store_id"?: string,"token_hash"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "invitations_store_id_stores_id_fk"
      columns: ["store_id"]
isOneToOne: false
      referencedRelation: "stores"
      referencedColumns: ["id"]
    }
                  ]
                },"product_costs": {
                  Row: {
                    "cost_price": number,"product_id": string,"store_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "cost_price"?: number,"product_id": string,"store_id": string,"updated_at"?: string
                  }
                  Update: {
                    "cost_price"?: number,"product_id"?: string,"store_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "product_costs_product_fk"
      columns: ["product_id","store_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id","store_id"]
    }
                  ]
                },"products": {
                  Row: {
                    "active": boolean,"barcode": string | null,"category": string | null,"created_at": string,"created_by": string | null,"deleted_at": string | null,"id": string,"is_low_stock": boolean,"low_stock_threshold": number,"name": string,"sale_price": number,"sku": string,"stock": number,"store_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"barcode"?: string | null,"category"?: string | null,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"id"?: string,"is_low_stock"?: never,"low_stock_threshold"?: number,"name": string,"sale_price": number,"sku": string,"stock"?: number,"store_id": string,"updated_at"?: string
                  }
                  Update: {
                    "active"?: boolean,"barcode"?: string | null,"category"?: string | null,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"id"?: string,"is_low_stock"?: never,"low_stock_threshold"?: number,"name"?: string,"sale_price"?: number,"sku"?: string,"stock"?: number,"store_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "products_store_id_stores_id_fk"
      columns: ["store_id"]
isOneToOne: false
      referencedRelation: "stores"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "created_at": string,"email": string | null,"full_name": string | null,"id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"email"?: string | null,"full_name"?: string | null,"id": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"email"?: string | null,"full_name"?: string | null,"id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"return_items": {
                  Row: {
                    "id": string,"quantity": number,"refund_amount": number,"return_id": string,"sale_item_id": string,"store_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "id"?: string,"quantity": number,"refund_amount": number,"return_id": string,"sale_item_id": string,"store_id": string
                  }
                  Update: {
                    "id"?: string,"quantity"?: number,"refund_amount"?: number,"return_id"?: string,"sale_item_id"?: string,"store_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "return_items_return_fk"
      columns: ["return_id","store_id"]
isOneToOne: false
      referencedRelation: "returns"
      referencedColumns: ["id","store_id"]
    },{
      foreignKeyName: "return_items_sale_item_fk"
      columns: ["sale_item_id","store_id"]
isOneToOne: false
      referencedRelation: "sale_items"
      referencedColumns: ["id","store_id"]
    }
                  ]
                },"returns": {
                  Row: {
                    "created_at": string,"created_by": string | null,"id": string,"reason": string | null,"refund_method": Database["public"]['Enums']["payment_method"],"refund_total": number,"sale_id": string,"store_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"reason"?: string | null,"refund_method": Database["public"]['Enums']["payment_method"],"refund_total": number,"sale_id": string,"store_id": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"reason"?: string | null,"refund_method"?: Database["public"]['Enums']["payment_method"],"refund_total"?: number,"sale_id"?: string,"store_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "returns_sale_fk"
      columns: ["sale_id","store_id"]
isOneToOne: false
      referencedRelation: "sales"
      referencedColumns: ["id","store_id"]
    }
                  ]
                },"sale_item_costs": {
                  Row: {
                    "sale_item_id": string,"store_id": string,"unit_cost": number
                  }
                  ComputedFields: never
                  Insert: {
                    "sale_item_id": string,"store_id": string,"unit_cost": number
                  }
                  Update: {
                    "sale_item_id"?: string,"store_id"?: string,"unit_cost"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "sale_item_costs_sale_item_fk"
      columns: ["sale_item_id","store_id"]
isOneToOne: false
      referencedRelation: "sale_items"
      referencedColumns: ["id","store_id"]
    }
                  ]
                },"sale_items": {
                  Row: {
                    "discount": number,"id": string,"line_total": number,"product_id": string,"product_name": string,"quantity": number,"sale_id": string,"sku": string,"store_id": string,"unit_price": number
                  }
                  ComputedFields: never
                  Insert: {
                    "discount"?: number,"id"?: string,"line_total": number,"product_id": string,"product_name": string,"quantity": number,"sale_id": string,"sku": string,"store_id": string,"unit_price": number
                  }
                  Update: {
                    "discount"?: number,"id"?: string,"line_total"?: number,"product_id"?: string,"product_name"?: string,"quantity"?: number,"sale_id"?: string,"sku"?: string,"store_id"?: string,"unit_price"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "sale_items_product_fk"
      columns: ["product_id","store_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id","store_id"]
    },{
      foreignKeyName: "sale_items_sale_fk"
      columns: ["sale_id","store_id"]
isOneToOne: false
      referencedRelation: "sales"
      referencedColumns: ["id","store_id"]
    }
                  ]
                },"sale_payments": {
                  Row: {
                    "amount": number,"created_at": string,"id": string,"method": Database["public"]['Enums']["payment_method"],"sale_id": string,"store_id": string,"tendered": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"created_at"?: string,"id"?: string,"method": Database["public"]['Enums']["payment_method"],"sale_id": string,"store_id": string,"tendered"?: number | null
                  }
                  Update: {
                    "amount"?: number,"created_at"?: string,"id"?: string,"method"?: Database["public"]['Enums']["payment_method"],"sale_id"?: string,"store_id"?: string,"tendered"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "sale_payments_sale_fk"
      columns: ["sale_id","store_id"]
isOneToOne: false
      referencedRelation: "sales"
      referencedColumns: ["id","store_id"]
    }
                  ]
                },"sales": {
                  Row: {
                    "cashier_id": string | null,"created_at": string,"customer_id": string | null,"discount_total": number,"id": string,"idempotency_key": string,"note": string | null,"number": number,"prices_include_tax": boolean,"status": Database["public"]['Enums']["sale_status"],"store_id": string,"subtotal": number,"tax_rate": number,"tax_total": number,"total": number
                  }
                  ComputedFields: never
                  Insert: {
                    "cashier_id"?: string | null,"created_at"?: string,"customer_id"?: string | null,"discount_total"?: number,"id"?: string,"idempotency_key": string,"note"?: string | null,"number": number,"prices_include_tax": boolean,"status"?: Database["public"]['Enums']["sale_status"],"store_id": string,"subtotal": number,"tax_rate": number,"tax_total": number,"total": number
                  }
                  Update: {
                    "cashier_id"?: string | null,"created_at"?: string,"customer_id"?: string | null,"discount_total"?: number,"id"?: string,"idempotency_key"?: string,"note"?: string | null,"number"?: number,"prices_include_tax"?: boolean,"status"?: Database["public"]['Enums']["sale_status"],"store_id"?: string,"subtotal"?: number,"tax_rate"?: number,"tax_total"?: number,"total"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "sales_customer_fk"
      columns: ["customer_id","store_id"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["id","store_id"]
    },{
      foreignKeyName: "sales_store_id_stores_id_fk"
      columns: ["store_id"]
isOneToOne: false
      referencedRelation: "stores"
      referencedColumns: ["id"]
    }
                  ]
                },"stock_entries": {
                  Row: {
                    "created_at": string,"created_by": string | null,"id": string,"note": string | null,"source": string,"store_id": string,"supplier": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"note"?: string | null,"source"?: string,"store_id": string,"supplier"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"note"?: string | null,"source"?: string,"store_id"?: string,"supplier"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "stock_entries_store_id_stores_id_fk"
      columns: ["store_id"]
isOneToOne: false
      referencedRelation: "stores"
      referencedColumns: ["id"]
    }
                  ]
                },"stock_entry_items": {
                  Row: {
                    "entry_id": string,"id": string,"product_id": string,"quantity": number,"store_id": string,"unit_cost": number
                  }
                  ComputedFields: never
                  Insert: {
                    "entry_id": string,"id"?: string,"product_id": string,"quantity": number,"store_id": string,"unit_cost": number
                  }
                  Update: {
                    "entry_id"?: string,"id"?: string,"product_id"?: string,"quantity"?: number,"store_id"?: string,"unit_cost"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "stock_entry_items_entry_fk"
      columns: ["entry_id","store_id"]
isOneToOne: false
      referencedRelation: "stock_entries"
      referencedColumns: ["id","store_id"]
    },{
      foreignKeyName: "stock_entry_items_product_fk"
      columns: ["product_id","store_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id","store_id"]
    }
                  ]
                },"stock_movements": {
                  Row: {
                    "created_at": string,"created_by": string | null,"id": number,"product_id": string,"quantity": number,"ref_id": string,"stock_after": number,"store_id": string,"type": Database["public"]['Enums']["stock_movement_type"]
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: never,"product_id": string,"quantity": number,"ref_id": string,"stock_after": number,"store_id": string,"type": Database["public"]['Enums']["stock_movement_type"]
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: never,"product_id"?: string,"quantity"?: number,"ref_id"?: string,"stock_after"?: number,"store_id"?: string,"type"?: Database["public"]['Enums']["stock_movement_type"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "stock_movements_product_fk"
      columns: ["product_id","store_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id","store_id"]
    }
                  ]
                },"store_members": {
                  Row: {
                    "created_at": string,"id": string,"role": Database["public"]['Enums']["store_role"],"store_id": string,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"role": Database["public"]['Enums']["store_role"],"store_id": string,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"role"?: Database["public"]['Enums']["store_role"],"store_id"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "store_members_store_id_stores_id_fk"
      columns: ["store_id"]
isOneToOne: false
      referencedRelation: "stores"
      referencedColumns: ["id"]
    }
                  ]
                },"stores": {
                  Row: {
                    "created_at": string,"created_by": string | null,"currency": string,"id": string,"last_sale_number": number,"max_cashier_discount_pct": number,"name": string,"prices_include_tax": boolean,"slug": string,"tax_rate": number,"ticket_footer": string | null,"timezone": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"currency"?: string,"id"?: string,"last_sale_number"?: number,"max_cashier_discount_pct"?: number,"name": string,"prices_include_tax"?: boolean,"slug": string,"tax_rate"?: number,"ticket_footer"?: string | null,"timezone"?: string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"currency"?: string,"id"?: string,"last_sale_number"?: number,"max_cashier_discount_pct"?: number,"name"?: string,"prices_include_tax"?: boolean,"slug"?: string,"tax_rate"?: number,"ticket_footer"?: string | null,"timezone"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"stripe_events": {
                  Row: {
                    "id": string,"processed_at": string | null,"received_at": string,"type": string
                  }
                  ComputedFields: never
                  Insert: {
                    "id": string,"processed_at"?: string | null,"received_at"?: string,"type": string
                  }
                  Update: {
                    "id"?: string,"processed_at"?: string | null,"received_at"?: string,"type"?: string
                  }
                  Relationships: [
                    
                  ]
                },"subscriptions": {
                  Row: {
                    "cancel_at_period_end": boolean,"created_at": string,"current_period_end": string | null,"price_id": string | null,"status": Database["public"]['Enums']["subscription_status"],"store_id": string,"stripe_customer_id": string,"stripe_subscription_id": string | null,"trial_end": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "cancel_at_period_end"?: boolean,"created_at"?: string,"current_period_end"?: string | null,"price_id"?: string | null,"status": Database["public"]['Enums']["subscription_status"],"store_id": string,"stripe_customer_id": string,"stripe_subscription_id"?: string | null,"trial_end"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "cancel_at_period_end"?: boolean,"created_at"?: string,"current_period_end"?: string | null,"price_id"?: string | null,"status"?: Database["public"]['Enums']["subscription_status"],"store_id"?: string,"stripe_customer_id"?: string,"stripe_subscription_id"?: string | null,"trial_end"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "subscriptions_store_id_stores_id_fk"
      columns: ["store_id"]
isOneToOne: true
      referencedRelation: "stores"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "accept_invitation":
{ Args: { "p_token": string }; Returns: string
                           },
"create_return":
{ Args: { "p_items": Json,"p_reason"?: string,"p_refund_method"?: Database["public"]['Enums']["payment_method"],"p_sale_id": string }; Returns: string
                           },
"create_sale":
{ Args: { "p_customer_id"?: string,"p_discount"?: number,"p_idempotency_key": string,"p_items": Json,"p_note"?: string,"p_payments": Json,"p_store_id": string }; Returns: string
                           },
"create_stock_entry":
{ Args: { "p_items": Json,"p_note"?: string,"p_store_id": string,"p_supplier"?: string }; Returns: string
                           },
"create_store":
{ Args: { "p_currency"?: string,"p_name": string,"p_prices_include_tax"?: boolean,"p_tax_rate"?: number,"p_timezone"?: string }; Returns: string
                           },
"import_products":
{ Args: { "p_file_name": string,"p_rows": Json,"p_skipped_rows": number,"p_store_id": string,"p_total_rows": number,"p_update_existing": boolean }; Returns: string
                           },
"invitation_preview":
{ Args: { "p_token": string }; Returns: {
              "email": string,"expires_at": string,"role": Database["public"]['Enums']["store_role"],"status": string,"store_name": string
            }[]
                           }
          }
          Enums: {
            "activity_action": "insert"|"update"|"delete","payment_method": "cash"|"card"|"transfer","sale_status": "completed"|"partially_returned"|"returned","stock_movement_type": "sale"|"return"|"entry","store_role": "owner"|"admin"|"cashier","subscription_status": "trialing"|"active"|"past_due"|"canceled"|"unpaid"|"incomplete"|"incomplete_expired"|"paused"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            "activity_action": ["insert", "update", "delete"],"payment_method": ["cash", "card", "transfer"],"sale_status": ["completed", "partially_returned", "returned"],"stock_movement_type": ["sale", "return", "entry"],"store_role": ["owner", "admin", "cashier"],"subscription_status": ["trialing", "active", "past_due", "canceled", "unpaid", "incomplete", "incomplete_expired", "paused"]
          }
        }
} as const

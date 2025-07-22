export interface PricingValidationResult {
    isValid: boolean;
    errors: string[];
  }
  
  export function validatePricingData(
    selectedProducts: any[],
    adjustmentType: string,
    adjustmentValue: number
  ): PricingValidationResult {
    const errors: string[] = [];
    
    // Vérifier la sélection de produits
    if (!selectedProducts || selectedProducts.length === 0) {
      errors.push("Vous devez sélectionner au moins un produit");
    }
    
    if (selectedProducts.length > 100) {
      errors.push("Maximum 100 produits peuvent être modifiés à la fois");
    }
    
    // Vérifier le type d'ajustement
    if (!["percentage", "fixed", "add", "subtract"].includes(adjustmentType)) {
      errors.push("Type d'ajustement invalide");
    }
    
    // Vérifier la valeur d'ajustement
    if (isNaN(adjustmentValue)) {
      errors.push("La valeur d'ajustement doit être un nombre");
    }
    
    if (adjustmentType === "percentage") {
      if (adjustmentValue < -99 || adjustmentValue > 1000) {
        errors.push("Le pourcentage doit être entre -99% et +1000%");
      }
    }
    
    if (adjustmentType === "fixed") {
      if (adjustmentValue < 0.01 || adjustmentValue > 99999) {
        errors.push("Le prix fixe doit être entre 0,01€ et 99 999€");
      }
    }
    
    if (adjustmentType === "subtract") {
      // Vérifier qu'on ne va pas en dessous de 0.01€
      const hasNegativeResult = selectedProducts.some(product => 
        product.variants.some((variant: any) => 
          variant.currentPrice - adjustmentValue < 0.01
        )
      );
      
      if (hasNegativeResult) {
        errors.push("La soustraction rendrait certains prix négatifs ou nuls");
      }
    }
    
    return {
      isValid: errors.length === 0,
      errors
    };
  }
  
  export function validateProductData(product: any): boolean {
    if (!product.id || !product.title) return false;
    if (!product.variants || product.variants.length === 0) return false;
    
    return product.variants.every((variant: any) => 
      variant.id && 
      typeof variant.currentPrice === 'number' && 
      variant.currentPrice >= 0
    );
  }
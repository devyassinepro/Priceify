import { LoaderFunctionArgs } from "@remix-run/node";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const chargeId = url.searchParams.get("charge_id");
  
  console.log(`🎉 Billing return with charge_id: ${chargeId}`);
  console.log(`🔗 Full return URL: ${url.toString()}`);

  // ✅ SIMPLE: Page de succès avec redirection automatique vers l'app
  return new Response(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>🎉 Payment Successful!</title>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
        body {
          font-family: system-ui, -apple-system, sans-serif;
          text-align: center;
          padding: 2rem;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0;
        }
        .container {
          background: rgba(255, 255, 255, 0.1);
          padding: 3rem;
          border-radius: 20px;
          backdrop-filter: blur(10px);
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
          max-width: 500px;
        }
        .success-icon {
          font-size: 4rem;
          margin-bottom: 1rem;
          animation: bounce 2s infinite;
        }
        @keyframes bounce {
          0%, 20%, 50%, 80%, 100% { transform: translateY(0); }
          40% { transform: translateY(-10px); }
          60% { transform: translateY(-5px); }
        }
        .spinner {
          border: 4px solid rgba(255, 255, 255, 0.3);
          border-top: 4px solid white;
          border-radius: 50%;
          width: 50px;
          height: 50px;
          animation: spin 1s linear infinite;
          margin: 2rem auto;
        }
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        .step {
          margin: 1rem 0;
          padding: 0.5rem;
          background: rgba(255, 255, 255, 0.1);
          border-radius: 10px;
          opacity: 0.7;
          transition: all 0.3s ease;
        }
        .step.active {
          opacity: 1;
          background: rgba(255, 255, 255, 0.2);
          transform: scale(1.02);
        }
        .step.completed {
          background: rgba(76, 175, 80, 0.3);
        }
        .charge-id {
          font-family: monospace;
          background: rgba(255, 255, 255, 0.2);
          padding: 0.5rem;
          border-radius: 8px;
          margin: 1rem 0;
          font-size: 0.9em;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="success-icon">🎉</div>
        <h1>Payment Successful!</h1>
        <p>Your subscription has been approved by Shopify!</p>
        
        ${chargeId ? `<div class="charge-id">Charge ID: ${chargeId}</div>` : ''}
        
        <div class="spinner"></div>
        
        <div class="step" id="step1">✅ Payment confirmed</div>
        <div class="step" id="step2">🔄 Activating subscription...</div>
        <div class="step" id="step3">🚀 Redirecting to your app...</div>
        
        <p style="font-size: 0.9em; margin-top: 2rem; opacity: 0.8;">
          This should only take a few seconds...
        </p>
        
        <div style="margin-top: 2rem; opacity: 0.7;">
          <p style="font-size: 0.8em;">
            If you're not redirected automatically, 
            <a href="/app" style="color: white; text-decoration: underline;">click here</a>
          </p>
        </div>
      </div>
      
      <script>
        console.log('🎉 Billing return page loaded');
        console.log('📋 Charge ID: ${chargeId || 'None'}');
        
        let step = 1;
        
        function activateStep(stepNum) {
          const stepEl = document.getElementById('step' + stepNum);
          if (stepEl) {
            stepEl.classList.add('active');
            
            // Mark previous steps as completed
            for (let i = 1; i < stepNum; i++) {
              const prevStep = document.getElementById('step' + i);
              if (prevStep) {
                prevStep.classList.add('completed');
                prevStep.classList.remove('active');
              }
            }
          }
        }
        
        // Étape 1: Paiement confirmé (immédiat)
        activateStep(1);
        
        // Étape 2: Activation (après 1.5 secondes)
        setTimeout(() => {
          activateStep(2);
        }, 1500);
        
        // Étape 3: Redirection (après 3 secondes)
        setTimeout(() => {
          activateStep(3);
          
          // Masquer le spinner
          const spinner = document.querySelector('.spinner');
          if (spinner) spinner.style.display = 'none';
          
          // Rediriger vers l'app avec trigger de sync
          const returnUrl = '/app?billing_completed=1&sync_needed=1&charge_id=${chargeId || ''}';
          console.log('🔄 Redirecting to:', returnUrl);
          
          // Utiliser window.top pour sortir de l'iframe si nécessaire
          try {
            if (window.top && window.top !== window) {
              window.top.location.href = returnUrl;
            } else {
              window.location.href = returnUrl;
            }
          } catch (e) {
            console.log('🔄 Fallback redirect');
            window.location.href = returnUrl;
          }
        }, 3000);
        
        // Fallback si la redirection échoue (après 10 secondes)
        setTimeout(() => {
          if (window.location.pathname === '/billing-return') {
            console.log('⚠️ Fallback redirect triggered');
            window.location.href = '/app?sync_needed=1';
          }
        }, 10000);
        
        // Debug: Log toutes les 2 secondes pour voir si on est toujours là
        let debugCount = 0;
        const debugInterval = setInterval(() => {
          debugCount++;
          console.log(\`🕐 Still on billing-return page (count: \${debugCount})\`);
          
          if (debugCount > 10) {
            clearInterval(debugInterval);
            console.log('🚨 Too long on billing page, forcing redirect');
            window.location.href = '/app';
          }
        }, 2000);
      </script>
    </body>
    </html>
  `, {
    headers: {
      'Content-Type': 'text/html',
    },
  });
};

export default function BillingReturn() {
  // Cette page ne devrait jamais s'afficher car le loader retourne une Response HTML
  return null;
}
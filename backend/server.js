const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
require('dotenv').config();
const app = express();
app.use(bodyParser.json({limit:'60mb'}));
app.use('/uploads', express.static(path.join(__dirname,'uploads')));
const PORT = process.env.PORT || 4000;
if(!fs.existsSync(path.join(__dirname,'uploads'))){ fs.mkdirSync(path.join(__dirname,'uploads')); }
app.post('/api/upload-design', async (req,res)=>{
  try{
    const { image } = req.body;
    if(!image) return res.status(400).json({ error:'No image' });
    const m = image.match(/^data:(image\/(png|jpeg));base64,(.+)$/);
    if(!m) return res.status(400).json({ error:'Bad image format' });
    const ext = m[2] === 'png' ? 'png' : 'jpg';
    const b = Buffer.from(m[3], 'base64');
    const name = `design_${Date.now()}.${ext}`;
    const p = path.join(__dirname,'uploads',name);
    fs.writeFileSync(p,b);
    const publicUrl = (process.env.PUBLIC_BASE_URL || ('http://localhost:'+PORT)) + '/uploads/' + name;
    return res.json({ url: publicUrl });
  }catch(err){ console.error(err); return res.status(500).json({ error: err.message }); }
});
app.post('/api/create-gelato-order', async (req,res)=>{
  try{
    const GELATO_KEY = process.env.GELATO_API_KEY;
    if(!GELATO_KEY) return res.status(500).json({ error:'Missing GELATO_API_KEY' });
    const payload = req.body;
    const resp = await fetch('https://order.gelatoapis.com/v3/orders', {
      method:'POST', headers:{ 'Content-Type':'application/json','Authorization':`Bearer ${GELATO_KEY}` }, body: JSON.stringify(payload)
    });
    const j = await resp.json();
    if(!resp.ok) return res.status(500).json({ error: j });
    return res.json(j);
  }catch(err){ console.error(err); return res.status(500).json({ error: err.message }); }
});
app.post('/webhook/shopify', async (req,res)=>{
  try{
    const order = req.body;
    let designUrl = null;
    if(order && order.line_items){
      for(const li of order.line_items){
        if(li.properties){
          for(const p of li.properties){
            if(p.name && p.name.toLowerCase().includes('design')){ designUrl = p.value; break; }
          }
        }
        if(designUrl) break;
      }
    }
    if(!designUrl && order.note_attributes){
      for(const na of order.note_attributes){
        if(na.name && na.name.toLowerCase().includes('design')){ designUrl = na.value; break; }
      }
    }
    if(!designUrl){
      console.warn('No design URL on order', order.id);
      return res.status(200).json({ ok:true, warning:'no design url' });
    }
    const li = order.line_items[0];
    const productId = process.env.GELATO_PRODUCT_ID;
    const variantId = process.env.GELATO_VARIANT_ID;
    const items = [{ productId, variantId, quantity: li.quantity || 1, printDetails: { images: [ designUrl ], side: 'both' } }];
    const shippingAddress = { name: order.shipping_address ? (order.shipping_address.name || (order.shipping_address.first_name + ' ' + order.shipping_address.last_name)) : (order.customer ? order.customer.first_name : 'Kund'), addressLine1: order.shipping_address ? order.shipping_address.address1 : '', city: order.shipping_address ? order.shipping_address.city : '', postalCode: order.shipping_address ? order.shipping_address.zip : '', country: order.shipping_address ? order.shipping_address.country_code : 'SE' };
    const GELATO_KEY = process.env.GELATO_API_KEY;
    const gelatoPayload = { reference: `shopify-${order.id}`, shippingAddress, items };
    const resp = await fetch('https://order.gelatoapis.com/v3/orders', { method:'POST', headers:{ 'Content-Type':'application/json','Authorization': `Bearer ${GELATO_KEY}` }, body: JSON.stringify(gelatoPayload) });
    const gelatoJson = await resp.json();
    if(!resp.ok){ console.error('Gelato error', gelatoJson); return res.status(500).json({ error: gelatoJson }); }
    return res.json({ ok:true, gelato: gelatoJson });
  }catch(err){ console.error(err); res.status(500).json({ error: err.message }); }
});
app.listen(PORT, ()=> console.log('Server listening on', PORT));
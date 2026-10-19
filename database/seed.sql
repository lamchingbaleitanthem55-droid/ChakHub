-- Sample catalogue. Run after schema.sql. (Test user accounts come from `npm run seed`.)
insert into coupons (code, discount_type, discount_value, minimum_order, usage_limit, expiry_date)
values ('WELCOME50','fixed',50,199,1000, now() + interval '1 year'),
       ('SAVE10','percent',10,299,null, now() + interval '1 year');

with r as (
  insert into restaurants (name, description, address, latitude, longitude, phone, cuisine, opening_time, closing_time, delivery_fee, rating, image)
  values
   ('Spice Route Biryani','Dum biryani and kebabs','Paona Bazar, Imphal',24.8074,93.9384,'9000010001','{Biryani,Indian}','10:00','23:00',25,4.4,'https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?w=800'),
   ('Slice Society','Wood-fired pizzas and pasta','Thangal Bazar, Imphal',24.8160,93.9440,'9000010002','{Pizza,Fast Food}','11:00','23:30',30,4.2,'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=800')
  returning id, name)
insert into food_items (restaurant_id, name, description, price, category, is_veg, image)
select r.id, f.name, f.description, f.price, f.category, f.is_veg, f.image from r
join (values
 ('Spice Route Biryani','Chicken Dum Biryani','Basmati rice, slow-cooked chicken',249,'Biryani',false,'https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?w=600'),
 ('Spice Route Biryani','Paneer Tikka','Charred cottage cheese, mint chutney',189,'Indian',true,'https://images.unsplash.com/photo-1567188040759-fb8a883dc6d8?w=600'),
 ('Slice Society','Margherita Pizza','Tomato, mozzarella, basil',199,'Pizza',true,'https://images.unsplash.com/photo-1574071318508-1cdbab80d002?w=600'),
 ('Slice Society','Pepperoni Pizza','Spicy pepperoni, extra cheese',299,'Pizza',false,'https://images.unsplash.com/photo-1628840042765-356cda07504e?w=600')
) as f(rname,name,description,price,category,is_veg,image) on f.rname = r.name;

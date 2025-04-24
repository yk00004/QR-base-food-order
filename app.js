const express = require("express");
const app = express();
const ejsMate = require("ejs-mate");
const mongoose = require("mongoose");
const path = require("path");

const flash = require("connect-flash");

app.use(flash());
app.use(express.static(path.join(__dirname, "/public")));
app.set("views", path.join(__dirname, "views"));
app.engine("ejs", ejsMate);
app.set("view engine", "ejs");

const Food = require("./models/food.js");
const Table = require("./models/table.js");
const Order = require("./models/order.js");
const User = require("./models/User.js");

const passport = require("passport");
const session = require("express-session");
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(
  session({
    secret: "my_secret_key",
    resave: false,
    saveUninitialized: true,
    cookie: {
      secure: false,
      maxAge: 1000 * 60 * 60 * 24,
    },
  })
);

app.use(passport.initialize());
app.use(passport.session());
passport.use(User.createStrategy());
passport.serializeUser(User.serializeUser());
passport.deserializeUser(User.deserializeUser());

app.use((req, res, next) => {
  res.locals.success = req.flash("success");
  res.locals.error = req.flash("error");
  res.locals.currentUser = req.user || null;
  res.locals.tableNumber = req.session.tableNumber || null;
  console.log(req.user);
  next();
});

const Stripe = require("stripe");
const dotenv = require("dotenv");
dotenv.config();

main().then(() => {
  console.log("kkb data base connected...!");
});
async function main() {
  mongoose.connect("mongodb://localhost:27017/kkb_food_flow");
}

app.get("/login", (req, res) => {
  res.render("user/login");
});
app.post("/login", (req, res, next) => {
  const savedTableNumber = req.session.tableNumber;
  passport.authenticate("local", (err, user, info) => {
    if (err) {
      req.flash("error", "Something went wrong. Please try again.");
      return res.redirect("/login");
    }
    if (!user) {
      req.flash("error", "Invalid username or password.");
      return res.redirect("/login");
    }
    req.logIn(user, (err) => {
      if (err) {
        req.flash("error", "Login failed. Please try again.");
        return res.redirect("/login");
      }
      req.session.tableNumber = savedTableNumber;
      req.flash("success", "Welcome back, " + user.username + "!");
      return res.redirect("/");
    });
  })(req, res, next);
});
app.get("/signup", (req, res) => {
  res.render("user/signup");
});
app.post("/signup", async (req, res) => {
  const savedTableNumber = req.session.tableNumber;
  try {
    const { username, email, number, password } = req.body;

    // Check if email or number already exists
    const existingUser = await User.findOne({ $or: [{ email }, { number }] });
    if (existingUser) {
      req.flash("error", "Email or Phone number already exists.");
      return res.redirect("/login");
    }

    const newUser = new User({ username, email, number });
    await User.register(newUser, password); // `passport-local-mongoose` handles hashing
    req.logIn(newUser, (err) => {
      if (err) {
        req.flash("error", "Something went wrong during login.");
        return res.redirect("/signup");
      }

      req.flash("success", "Registered and logged in successfully! Welcome.");
      req.session.tableNumber = savedTableNumber;
      res.redirect("/"); // Redirect to home or dashboard
    });
  } catch (error) {
    console.error("Signup Error:", error);
    req.flash("error", "Something went wrong. Try again.");
    res.status(500).send("Internal Server Error");
  }
});
app.get("/logout", (req, res) => {
  req.logout((err) => {
    if (err) {
      req.flash("error", "Logout failed.");
      return res.redirect("/");
    }
    req.flash("success", "Logged out successfully!");
    res.redirect("/");
  });
});

app.get("/", (req, res) => {
  res.render("main/index.ejs");
});
app.get("/menu", async (req, res) => {
  try {
    const category = req.query.category || "All";
    const data = await Food.find(); // Fetch food items
    res.render("menu", { category, data });
  } catch (error) {
    console.error(error);
    res.status(500).send("Error fetching menu.");
  }
});

app.get("/table/:tableNumber", async (req, res) => {
  try {
    const { tableNumber } = req.params;
    const table = await Table.findOne({ tableNumber });

    if (!table) {
      return res.status(404).send("Table not found.");
    }

    // If the table is occupied, inform the user
    if (table.status == "occupied") {
      // return res.render('message', { message: "This table is currently occupied. Please wait for it to become available." });
    }

    // Fetch the food items from the database
    req.session.tableNumber = tableNumber;

    res.redirect("/");
  } catch (error) {
    console.error(error);
    res.status(500).send("Error fetching table.");
  }
});

app.post("/order/:tableNumber", async (req, res) => {
  try {
    const { tableNumber } = req.params;
    const { items } = req.body; // items should be an array of { foodId, quantity }

    const table = await Table.findOne({ tableNumber });
    if (!table) {
      return res.status(404).send("Table not found.");
    }

    // If the table is available, mark it as occupied
    if (table.status === "available") {
      table.status = "occupied";
      await table.save();

      // Create the order
      const foodItems = await Food.find({
        _id: { $in: items.map((item) => item.foodId) },
      });

      const totalAmount = foodItems.reduce((total, foodItem) => {
        const orderedItem = items.find(
          (i) => i.foodId.toString() === foodItem._id.toString()
        );
        return total + foodItem.price * orderedItem.quantity;
      }, 0);

      const order = new Order({
        table: table._id,
        items: items.map((item) => ({
          food: item.foodId,
          quantity: item.quantity,
        })),
        totalAmount,
        orderStatus: "pending",
      });

      await order.save();

      res.send("Order placed successfully.");
    } else {
      return res.status(400).send("This table is already occupied.");
    }
  } catch (error) {
    console.error(error);
    res.status(500).send("Error placing order.");
  }
});
app.get("/checkout", (req, res) => {
  let cartItems = [];

  // If session.cart exists, use it; otherwise, it remains an empty array
  if (req.session.cart && req.session.cart.length > 0) {
    cartItems = req.session.cart;
  }

  let totalPrice = 0;

  cartItems.forEach((item) => {
    totalPrice += item.price * item.quantity;
  });
  res.render("main/confirm.ejs", { cartItems, totalPrice });
});
app.post("/order", async (req, res) => {
  try {
    const tableNumber = req.session.tableNumber;
    if (!tableNumber) {
      return res
        .status(400)
        .send("Table number not found. Please scan the QR code again.");
    }

    const table = await Table.findOne({ tableNumber });
    if (!table) {
      return res.status(404).send("Table not found.");
    }

    table.status = "occupied";
    await table.save();

    // if (!req.session.cart || req.session.cart.length === 0) {
    //     return res.status(400).send("Your cart is empty.");
    // }

    // const items = req.session.cart; // Get cart items from session
    // const foodItems = await Food.find({ _id: { $in: items.map(item => item.foodId) } });

    // const totalAmount = foodItems.reduce((total, foodItem) => {
    //     const orderedItem = items.find(i => i.foodId.toString() === foodItem._id.toString());
    //     return total + (foodItem.price * orderedItem.quantity);
    // }, 0);

    // const order = new Order({
    //     table: table._id,
    //     items: items.map(item => ({
    //         food: item.foodId,
    //         quantity: item.quantity,
    //     })),
    //     totalAmount,
    //     orderStatus: 'pending',
    // });

    // console.log("Saved Order:", order);
    // await order.save();

    req.flash("success", "Proceeding to checkout.");
    res.redirect("/checkout");
  } catch (error) {
    console.error("Error placing order:", error);
    req.flash("error", "Something went wrong while placing the order.");
    res.status(500).send("Error");
  }
});

// payment
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
app.post("/create-checkout-session", async (req, res) => {
  const session = await stripe.checkout.sessions.create({
    payment_method_types: ["card"],
    line_items: [
      {
        price_data: {
          currency: "inr",
          product_data: { name: "Test Product" },
          unit_amount: req.body.amount * 100, // Amount in paise
        },
        quantity: 1,
      },
    ],
    customer_email: req.user.email,
    mode: "payment",
    success_url: "http://localhost:8080/success?amount=" + req.body.amount,
    cancel_url: "http://localhost:8080/cart",
  });

  res.json({ id: session.id });
});

// send mail
const nodemailer = require("nodemailer");
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER, // Your Gmail
    pass: process.env.EMAIL_PASS, // Your App Password
  },
});
const sendPaymentSuccessEmail = async (to, amount, cartItems) => {
  let itemsHtml = cartItems
    .map(
      (item) =>
        `<li>${item.name} x ${item.quantity} — ₹${
          item.price * item.quantity
        }</li>`
    )
    .join("");
  await transporter.sendMail({
    from: '"Quick Bite Express" <your-email@gmail.com>',
    to,
    subject: "Payment Successful - QR Restaurant",
    html: `
            <h3>Thank you for your payment!</h3>
            <p>We have received your payment of ₹${amount} successfully.</p>
            <p><strong>Order Details:</strong></p>
            <ul>${itemsHtml}</ul>
            <br>
            <p>Your order is now being processed.</p>
            <p>~ Quick Bite Express</p>
        `,
  });
};
app.get("/success", async (req, res) => {
  try {
    const user = req.user; // Get user from session (ensure user is logged in)
    const amount = req.query.amount;
    const cartItems = req.session.cart || [];
    const tableNumber = req.session.tableNumber;

    const table = await Table.findOne({ tableNumber });
    if (!table) {
      req.flash("error", "Table not found.");
      return res.redirect("/");
    }

    table.status = "occupied";
    await table.save();

    const order = new Order({
      table: table._id,
      items: cartItems.map((item) => ({
        food: item.foodId,
        quantity: item.quantity,
      })),
      totalAmount: amount,
      orderStatus: "pending",
    });
    await order.save();

    await sendPaymentSuccessEmail(user.email, amount, cartItems);
    req.session.cart = [];

    res.render("main/success",{amount}); // Show confirmation page
  } catch (err) {
    console.error("Failed to send payment email:", err);
    res.status(500).send("Payment successful, but failed to send email.");
  }
});
// mail complet

app.post("/add-to-cart/:foodId", async (req, res) => {
  if (!req.user) {
    return res.redirect("/login"); // Ensure the user is logged in
  }
  if (res.locals.tableNumber == null) {
    req.flash("error", "for order scan QR from table to place order");
    return res.redirect("/");
  }
  const { foodId } = req.params;
  const { quantity = 1 } = req.body; // Default quantity to 1 if not provided

  // Fetch food item from the database
  const food = await Food.findById(foodId);
  if (!food) {
    return res.status(404).send("Food item not found.");
  }
  if (!req.session.cart) {
    req.session.cart = [];
  }
  let itemInCart = req.session.cart.find(
    (item) => item.foodId.toString() === foodId
  );

  if (itemInCart) {
    // If item is already in the cart, increase the quantity
    itemInCart.quantity += parseInt(quantity);
  } else {
    // If item is not in the cart, add it
    req.session.cart.push({
      foodId: food._id,
      name: food.name,
      price: food.price,
      quantity: parseInt(quantity),
    });
  }
  console.log(req.session.cart);

  res.redirect("/menu"); // Redirect to the cart page
});
app.get("/cart", (req, res) => {
  if (!req.user) {
    return res.redirect("/login"); // Ensure the user is logged in
  }
  if (res.locals.tableNumber == null) {
    req.flash("error", "for order scan QR from table to place order");
    return res.redirect("/");
  }

  console.log("Session Data:", req.session);

  // Declare cartItems at the top to prevent "Cannot access before initialization" errors
  let cartItems = [];

  // If session.cart exists, use it; otherwise, it remains an empty array
  if (req.session.cart && req.session.cart.length > 0) {
    cartItems = req.session.cart;
  }

  let totalPrice = 0;

  cartItems.forEach((item) => {
    totalPrice += item.price * item.quantity;
  });

  res.render("main/cart.ejs", {
    cartItems,
    totalPrice,
    message: cartItems.length === 0 ? "Your cart is empty." : null,
  });
});
app.post("/update-cart/:foodId", (req, res) => {
  if (!req.session.cart) {
    req.session.cart = []; // Ensure cart exists
  }

  const { foodId } = req.params;
  const { action } = req.body;

  let cart = req.session.cart;
  let itemIndex = cart.findIndex((item) => item.foodId === foodId);

  if (itemIndex !== -1) {
    if (action === "increase") {
      cart[itemIndex].quantity += 1;
    } else if (action === "decrease") {
      cart[itemIndex].quantity = Math.max(1, cart[itemIndex].quantity - 1);
    }
  }

  req.session.cart = cart; // Save updated cart back to session
  res.redirect("/cart"); // Redirect to update UI
});
app.post("/remove-from-cart/:foodId", (req, res) => {
  const { foodId } = req.params;

  if (!req.session.cart) {
    req.session.cart = [];
  }

  req.session.cart = req.session.cart.filter(
    (item) => item.foodId.toString() !== foodId
  );

  res.redirect("/cart"); // Reload the cart page after removing
});
// admin route
const adminRoutes = require("./roter/admin");
app.use("/admin", adminRoutes);

app.listen(8080, () => {
  console.log("connected to 8080");
});

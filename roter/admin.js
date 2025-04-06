const express = require("express");
const router = express.Router();
const Food = require("../models/food");
const Order = require("../models/order");

// Admin Dashboard - Show all orders with populated table and food details
router.get("/", async (req, res) => {
    try {
        const orders = await Order.find()
            .populate("table")
            .populate("items.food");

        res.render("admin/main", { orders });
    } catch (err) {
        console.error("Error loading admin dashboard:", err);
        res.status(500).send("Error loading dashboard.");
    }
});

// Show Menu Management Page
router.get("/menu", async (req, res) => {
    try {
        const foods = await Food.find();
        res.render("admin/menu", { foods });
    } catch (err) {
        console.error("Error loading menu:", err);
        res.status(500).send("Error loading menu.");
    }
});

// Add New Food Item (POST)
router.post("/menu", async (req, res) => {
    try {
        const { name, price, category } = req.body;
        await new Food({ name, price, category }).save();
        req.flash("success", "Food item added!");
        res.redirect("/admin/menu");
    } catch (err) {
        console.error("Error adding food:", err);
        req.flash("error", "Could not add food item.");
        res.redirect("/admin/menu");
    }
});

// Delete Food Item
router.post("/menu/:id/delete", async (req, res) => {
    try {
        await Food.findByIdAndDelete(req.params.id);
        req.flash("success", "Food item removed.");
        res.redirect("/admin/menu");
    } catch (err) {
        console.error("Error deleting food:", err);
        req.flash("error", "Could not delete food item.");
        res.redirect("/admin/menu");
    }
});

// Update Order Status
router.post("/order/:id/status", async (req, res) => {
    try {
        const order = await Order.findById(req.params.id);
        if (!order) {
            req.flash("error", "Order not found.");
            return res.redirect("/admin");
        }

        order.orderStatus = req.body.status;
        await order.save();
        req.flash("success", "Order status updated.");
        res.redirect("/admin");
    } catch (err) {
        console.error("Error updating order status:", err);
        req.flash("error", "Could not update order status.");
        res.redirect("/admin");
    }
});

module.exports = router;

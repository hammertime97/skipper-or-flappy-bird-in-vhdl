"""Dummy export files that look like real platform downloads.

Every name, order number and buyer here is made up. The files let a new seller
(or a tester) try the import flow without their own data, and they're used in tests.
Dates are generated relative to today so the files always look recent.
"""

from __future__ import annotations

import csv
import io
import math
import random
import re
from dataclasses import dataclass, replace
from datetime import datetime, timedelta, timezone


@dataclass(frozen=True)
class SampleProduct:
    sku: str  # "" = the seller never set a SKU (common on eBay and Etsy)
    name: str
    price: float
    cost: float
    weekly: float  # typical units per week
    growth: float  # weekly growth rate
    pattern: str  # steady | rising | viral | declining | seasonal | intermittent | new
    stock: int
    lead_days: int
    item_id: str = ""
    category: str = ""
    supplier: str = ""
    # Share the selling price has been cut by over the last 30 days (a forgotten discount), for the demo's profit leak finder.
    slip: float = 0.0


@dataclass(frozen=True)
class SampleStore:
    key: str
    platform: str
    title: str
    store_name: str
    niche: str
    filename: str
    products: tuple[SampleProduct, ...]


STORES: dict[str, SampleStore] = {
    s.key: s
    for s in [
        SampleStore(
            "ebay", "ebay", "eBay orders report", "RetroLoot (sample)", "retro gaming and tech gadgets",
            "ebay-orders-sample.csv",
            (
                SampleProduct("RG-35XX", "Handheld Retro Game Console 3.5in 64GB", 69.99, 38.00, 14, 0.02, "rising", 22, 14, "295810443211"),
                SampleProduct("", "Wireless Controller for Switch Pro Style", 24.99, 9.50, 20, 0.0, "steady", 60, 12, "295810443298"),
                SampleProduct("CRT-FLT", "CRT Scanline Filter HDMI Upscaler", 34.99, 14.20, 6, 0.0, "intermittent", 18, 18, "295810443305"),
                SampleProduct("GBA-SHL", "Clear Purple Replacement Shell for GBA", 12.99, 3.10, 16, -0.03, "declining", 140, 10, "295810443377"),
                SampleProduct("", "Mechanical Mini Keyboard 60% RGB", 49.99, 22.00, 9, 0.05, "viral", 15, 14, "295810443402"),
                SampleProduct("CART-RDR", "USB Cartridge Reader Dumper", 39.99, 17.50, 4, 0.0, "steady", 30, 21, "295810443489"),
                SampleProduct("LED-STRP", "Gaming Desk LED Strip 5m Sync", 19.99, 5.40, 11, 0.0, "seasonal", 75, 12, "295810443511"),
            ),
        ),
        SampleStore(
            "amazon", "amazon", "Amazon All Orders report", "Kitchen Nook (sample)", "kitchen gadgets",
            "amazon-all-orders-sample.txt",
            (
                SampleProduct("KN-GARLIC", "Garlic Press Rocker Stainless Steel", 14.99, 3.20, 30, 0.0, "steady", 210, 30, "B0D1EXAMP1"),
                SampleProduct("KN-SPIRAL", "Vegetable Spiralizer 5-Blade", 24.99, 7.80, 18, 0.03, "rising", 60, 35, "B0D1EXAMP2"),
                SampleProduct("KN-OILSPR", "Olive Oil Sprayer Glass 200ml", 12.99, 2.40, 24, 0.06, "viral", 45, 28, "B0D1EXAMP3"),
                SampleProduct("KN-SCALE", "Digital Kitchen Scale 5kg", 19.99, 6.10, 15, -0.02, "declining", 260, 30, "B0D1EXAMP4"),
                SampleProduct("KN-PASTA", "Pasta Drying Rack Bamboo", 21.99, 6.60, 5, 0.0, "seasonal", 90, 40, "B0D1EXAMP5"),
                SampleProduct("KN-CHOP", "Electric Mini Chopper 250W", 34.99, 13.00, 9, 0.0, "steady", 0, 30, "B0D1EXAMP6"),
            ),
        ),
        SampleStore(
            "shopify", "shopify", "Shopify orders export", "Iron & Oak Fitness (sample)", "home gym and fitness equipment",
            "shopify-orders-sample.csv",
            (
                SampleProduct("IO-BAND-SET", "Resistance Band Set (5 Levels)", 29.00, 7.50, 22, 0.02, "rising", 80, 21),
                SampleProduct("IO-GRIP", "Adjustable Hand Grip Strengthener", 15.00, 2.90, 18, 0.0, "steady", 150, 18),
                SampleProduct("IO-ROLLER", "Ab Roller Wheel with Knee Pad", 24.00, 6.20, 12, 0.0, "seasonal", 40, 21),
                SampleProduct("IO-MAT", "Extra Thick Yoga Mat 10mm", 39.00, 11.00, 9, 0.05, "viral", 25, 25),
                SampleProduct("IO-ROPE", "Weighted Jump Rope Ball Bearing", 19.00, 4.10, 10, -0.03, "declining", 190, 18),
                SampleProduct("IO-PUSHUP", "Push-Up Board 9-in-1", 34.00, 9.80, 6, 0.0, "new", 30, 21),
            ),
        ),
        SampleStore(
            "etsy", "etsy", "Etsy Order Items download", "Little Gem Studio (sample)", "handmade minimalist jewelry",
            "etsy-order-items-sample.csv",
            (
                SampleProduct("", "Personalized Initial Necklace Gold Filled", 38.00, 9.00, 12, 0.03, "seasonal", 0, 5, "1599001101"),
                SampleProduct("LG-HOOP", "Tiny Huggie Hoop Earrings Sterling Silver", 26.00, 5.50, 10, 0.0, "steady", 0, 5, "1599001102"),
                SampleProduct("", "Birthstone Stacking Ring Dainty", 32.00, 7.20, 7, 0.04, "rising", 0, 5, "1599001103"),
                SampleProduct("LG-CHARM", "Custom Pet Portrait Charm", 45.00, 11.00, 3, 0.0, "intermittent", 0, 7, "1599001104"),
                SampleProduct("", "Pearl Drop Bridal Earrings", 42.00, 10.50, 5, -0.02, "declining", 0, 5, "1599001105"),
            ),
        ),
        SampleStore(
            "tiktok", "tiktok", "TikTok Shop order export", "GlowLab (sample)", "beauty gadgets and skincare tools",
            "tiktok-orders-sample.csv",
            (
                SampleProduct("GL-ICEROLL", "Ice Roller for Face Depuffing", 16.99, 2.80, 40, 0.04, "viral", 120, 12, "1729500011"),
                SampleProduct("GL-LEDMASK", "LED Face Mask 7 Colours", 59.99, 19.00, 8, 0.03, "rising", 35, 15, "1729500012"),
                SampleProduct("GL-SCRUB", "Ultrasonic Skin Scrubber", 29.99, 7.40, 14, 0.0, "steady", 90, 12, "1729500013"),
                SampleProduct("GL-GUASHA", "Rose Quartz Gua Sha Set", 18.99, 3.60, 20, -0.04, "declining", 300, 12, "1729500014"),
                SampleProduct("GL-MIRROR", "Lighted Travel Makeup Mirror", 22.99, 6.90, 7, 0.0, "new", 50, 14, "1729500015"),
            ),
        ),
        SampleStore(
            "spreadsheet", "spreadsheet", "Your own Excel sheet", "Bloom & Bark (sample)", "eco-friendly pet products",
            "my-shop-spreadsheet-sample.xlsx",
            (
                SampleProduct("BB-POOBAG", "Compostable Poop Bags 240", 13.50, 3.20, 28, 0.0, "steady", 220, 14),
                SampleProduct("BB-BAMBOWL", "Bamboo Dog Bowl Set", 22.00, 6.80, 10, 0.02, "rising", 35, 21),
                SampleProduct("BB-HEMPTOY", "Hemp Rope Chew Toy", 11.00, 2.10, 16, 0.06, "viral", 40, 14),
                SampleProduct("BB-CORKBED", "Cork Cat Scratcher Bed", 35.00, 12.50, 4, 0.0, "intermittent", 26, 28),
                SampleProduct("BB-SHAMPOO", "Oatmeal Dog Shampoo 500ml", 15.00, 4.40, 12, -0.02, "declining", 130, 14),
            ),
        ),
    ]
}

# ---------------------------------------------------------------------------------------------
# A big store: about 550 products, many of them variants of each other (sizes, colours, models),
# with a few best sellers and a long tail of slow ones, like a real established eBay shop.
# ---------------------------------------------------------------------------------------------

# (family code, name, price, cost share, category, supplier, lead days, variant axes)
_FAMILIES: list[tuple[str, str, float, float, str, str, int, list[list[tuple[str, str]]]]] = [
    ("PC", "Silicone Phone Case", 12.99, 0.18, "Phone accessories", "Shenzhen MobileGear", 14,
     [[("IP16", "iPhone 16"), ("IP16P", "iPhone 16 Pro"), ("IP15", "iPhone 15"), ("IP15P", "iPhone 15 Pro"), ("IP14", "iPhone 14"), ("S24", "Galaxy S24"), ("PX8", "Pixel 8"), ("IP13", "iPhone 13")],
      [("BLK", "Black"), ("BLU", "Navy Blue"), ("PNK", "Pink"), ("CLR", "Clear"), ("GRN", "Sage Green")]]),
    ("SP", "Tempered Glass Screen Protector 2-Pack", 9.99, 0.12, "Phone accessories", "Shenzhen MobileGear", 14,
     [[("IP16", "iPhone 16"), ("IP16P", "iPhone 16 Pro"), ("IP15", "iPhone 15"), ("IP15P", "iPhone 15 Pro"), ("IP14", "iPhone 14"), ("S24", "Galaxy S24"), ("PX8", "Pixel 8"), ("IP13", "iPhone 13"), ("S23", "Galaxy S23"), ("A54", "Galaxy A54")]]),
    ("CB", "USB-C Fast Charging Cable", 8.99, 0.15, "Phone accessories", "Shenzhen MobileGear", 14,
     [[("1M", "1m"), ("2M", "2m"), ("3M", "3m")], [("BLK", "Black"), ("WHT", "White"), ("RED", "Red")]]),
    ("WC", "Wireless Charging Pad 15W", 19.99, 0.28, "Phone accessories", "Shenzhen MobileGear", 18,
     [[("BLK", "Black"), ("WHT", "White"), ("WOD", "Walnut Wood")]]),
    ("CM", "Magnetic Car Phone Mount", 15.99, 0.22, "Phone accessories", "Shenzhen MobileGear", 18,
     [[("VNT", "Air Vent"), ("DSH", "Dashboard"), ("WSH", "Windshield")], [("BLK", "Black"), ("SLV", "Silver")]]),
    ("EB", "Bluetooth Earbuds with Charging Case", 29.99, 0.33, "Audio", "Dongguan SoundTech", 21,
     [[("BLK", "Black"), ("WHT", "White"), ("NVY", "Navy"), ("PNK", "Blush Pink")]]),
    ("WB", "Insulated Stainless Steel Water Bottle", 21.99, 0.27, "Kitchen", "Yongkang HomeWare", 25,
     [[("500", "500ml"), ("750", "750ml"), ("1L", "1L")], [("BLK", "Matte Black"), ("WHT", "White"), ("SAG", "Sage"), ("LAV", "Lavender"), ("TEA", "Teal"), ("SND", "Sand")]]),
    ("BM", "Silicone Baking Mat", 11.99, 0.2, "Kitchen", "Yongkang HomeWare", 21,
     [[("HS", "Half Sheet"), ("QS", "Quarter Sheet"), ("RD", "Round 9in")], [("RED", "Red"), ("GRY", "Grey")]]),
    ("CBD", "Bamboo Cutting Board", 18.99, 0.26, "Kitchen", "Fujian Bamboo Co", 30,
     [[("S", "Small"), ("M", "Medium"), ("L", "Large"), ("XL", "Extra Large")]]),
    ("MP", "Glass Meal Prep Containers", 27.99, 0.31, "Kitchen", "Yongkang HomeWare", 25,
     [[("5PK", "5 Pack"), ("10PK", "10 Pack")], [("1C", "1 Compartment"), ("2C", "2 Compartment"), ("3C", "3 Compartment")]]),
    ("SJ", "Glass Spice Jars with Labels", 24.99, 0.24, "Kitchen", "Yongkang HomeWare", 25,
     [[("12", "12 Jars"), ("24", "24 Jars"), ("36", "36 Jars")]]),
    ("KN", "Chef Knife High Carbon Steel", 34.99, 0.3, "Kitchen", "Yangjiang Blades", 30,
     [[("6IN", "6in"), ("8IN", "8in"), ("10IN", "10in")]]),
    ("LS", "LED Strip Lights with Remote", 16.99, 0.21, "Home", "Zhongshan Lighting", 18,
     [[("5M", "5m"), ("10M", "10m"), ("15M", "15m"), ("20M", "20m")], [("RGB", "RGB"), ("WW", "Warm White")]]),
    ("PL", "Velvet Throw Pillow Cover", 13.99, 0.17, "Home", "Shaoxing Textiles", 28,
     [[("16", "16x16in"), ("18", "18x18in"), ("20", "20x20in"), ("24", "24x24in")], [("EMR", "Emerald"), ("MUS", "Mustard"), ("BLS", "Blush"), ("NVY", "Navy"), ("GRY", "Grey"), ("CRM", "Cream"), ("RST", "Rust"), ("TEL", "Teal")]]),
    ("CT", "Blackout Curtain Panels (2)", 32.99, 0.3, "Home", "Shaoxing Textiles", 28,
     [[("63", "63in"), ("84", "84in"), ("96", "96in")], [("BLK", "Black"), ("GRY", "Grey"), ("NVY", "Navy"), ("BEI", "Beige"), ("SAG", "Sage")]]),
    ("TW", "Cotton Bath Towel Set", 39.99, 0.34, "Home", "Shaoxing Textiles", 28,
     [[("4PC", "4 Piece"), ("6PC", "6 Piece")], [("WHT", "White"), ("GRY", "Grey"), ("SGE", "Sage"), ("NVY", "Navy")]]),
    ("CN", "Soy Wax Scented Candle", 17.99, 0.2, "Home", "Ningbo Fragrance", 21,
     [[("LAV", "Lavender"), ("VAN", "Vanilla"), ("SEA", "Sea Salt"), ("CIN", "Cinnamon"), ("FIG", "Fig"), ("PIN", "Pine"), ("RSE", "Rose"), ("CED", "Cedar")], [("8OZ", "8oz"), ("16OZ", "16oz")]]),
    ("DH", "No-Pull Dog Harness", 24.99, 0.22, "Pet supplies", "Hangzhou PetCare", 21,
     [[("XS", "XS"), ("S", "S"), ("M", "M"), ("L", "L"), ("XL", "XL")], [("BLK", "Black"), ("RED", "Red"), ("BLU", "Blue"), ("PNK", "Pink"), ("PUR", "Purple")]]),
    ("DL", "Reflective Dog Leash 5ft", 14.99, 0.2, "Pet supplies", "Hangzhou PetCare", 21,
     [[("BLK", "Black"), ("RED", "Red"), ("BLU", "Blue"), ("ORG", "Orange")]]),
    ("CS", "Cat Scratching Post", 29.99, 0.32, "Pet supplies", "Hangzhou PetCare", 30,
     [[("S", "Small"), ("M", "Medium"), ("L", "Tall")], [("BEI", "Beige"), ("GRY", "Grey")]]),
    ("PB", "Calming Donut Pet Bed", 34.99, 0.3, "Pet supplies", "Hangzhou PetCare", 30,
     [[("S", "Small"), ("M", "Medium"), ("L", "Large")], [("GRY", "Grey"), ("BRN", "Brown"), ("PNK", "Pink"), ("CRM", "Cream")]]),
    ("RB", "Resistance Bands Set", 19.99, 0.18, "Fitness", "Xiamen FitPro", 21,
     [[("LT", "Light"), ("MD", "Medium"), ("HV", "Heavy"), ("SET", "5-Band Set")]]),
    ("YM", "Non-Slip Yoga Mat", 26.99, 0.29, "Fitness", "Xiamen FitPro", 25,
     [[("6MM", "6mm"), ("10MM", "10mm")], [("PUR", "Purple"), ("BLK", "Black"), ("TEA", "Teal"), ("PNK", "Pink"), ("GRY", "Grey")]]),
    ("DB", "Neoprene Dumbbells (Pair)", 22.99, 0.35, "Fitness", "Xiamen FitPro", 30,
     [[("2LB", "2lb"), ("3LB", "3lb"), ("5LB", "5lb"), ("8LB", "8lb"), ("10LB", "10lb")]]),
    ("JR", "Weighted Jump Rope", 14.99, 0.19, "Fitness", "Xiamen FitPro", 21,
     [[("BLK", "Black"), ("BLU", "Blue"), ("PNK", "Pink")]]),
    ("MB", "Makeup Brush Set", 18.99, 0.17, "Beauty", "Guangzhou BeautyLab", 18,
     [[("10", "10 Piece"), ("14", "14 Piece")], [("BLK", "Black"), ("RSG", "Rose Gold"), ("PNK", "Pink")]]),
    ("HC", "Claw Hair Clips", 9.99, 0.12, "Beauty", "Guangzhou BeautyLab", 14,
     [[("4PK", "4 Pack"), ("6PK", "6 Pack"), ("8PK", "8 Pack")], [("NEU", "Neutral"), ("TRT", "Tortoise"), ("PST", "Pastel")]]),
    ("SS", "Silk Pillowcase", 22.99, 0.25, "Beauty", "Shaoxing Textiles", 28,
     [[("STD", "Standard"), ("QN", "Queen"), ("KG", "King")], [("CHM", "Champagne"), ("BLK", "Black"), ("BLS", "Blush"), ("SLV", "Silver")]]),
    ("DO", "Bamboo Desk Organizer", 23.99, 0.28, "Office", "Fujian Bamboo Co", 30,
     [[("3T", "3 Tier"), ("5S", "5 Slot"), ("DR", "With Drawer")]]),
    ("NB", "Dotted A5 Notebook", 12.99, 0.16, "Office", "Ningbo Paper", 21,
     [[("BLK", "Black"), ("NVY", "Navy"), ("SAG", "Sage"), ("TER", "Terracotta"), ("LAV", "Lavender"), ("MUS", "Mustard")]]),
    ("LD", "Adjustable Laptop Stand", 29.99, 0.3, "Office", "Shenzhen MobileGear", 21,
     [[("SLV", "Silver"), ("GRY", "Space Grey"), ("BLK", "Black")]]),
    ("BP", "Water-Resistant Laptop Backpack", 44.99, 0.33, "Bags", "Quanzhou BagWorks", 30,
     [[("15", "15.6in"), ("17", "17.3in")], [("BLK", "Black"), ("GRY", "Grey"), ("NVY", "Navy"), ("OLV", "Olive")]]),
    ("TT", "Canvas Tote Bag", 15.99, 0.18, "Bags", "Quanzhou BagWorks", 25,
     [[("NAT", "Natural"), ("BLK", "Black"), ("NVY", "Navy"), ("MUS", "Mustard"), ("SAG", "Sage")]]),
    ("PS", "Outdoor Solar Path Lights", 27.99, 0.3, "Garden", "Zhongshan Lighting", 25,
     [[("6PK", "6 Pack"), ("8PK", "8 Pack"), ("12PK", "12 Pack")], [("WW", "Warm White"), ("CLR", "Colour Changing")]]),
    ("PT", "Ceramic Plant Pot with Saucer", 16.99, 0.24, "Garden", "Dehua Ceramics", 35,
     [[("4IN", "4in"), ("6IN", "6in"), ("8IN", "8in")], [("WHT", "White"), ("TER", "Terracotta"), ("SAG", "Sage"), ("BLK", "Black")]]),
    ("WL", "Leather Wallet Phone Case", 21.99, 0.24, "Phone accessories", "Shenzhen MobileGear", 18,
     [[("IP16", "iPhone 16"), ("IP15", "iPhone 15"), ("IP14", "iPhone 14"), ("S24", "Galaxy S24"), ("PX8", "Pixel 8"), ("IP13", "iPhone 13")], [("BRN", "Brown"), ("BLK", "Black"), ("TAN", "Tan")]]),
    ("PG", "Phone Grip and Stand", 7.99, 0.12, "Phone accessories", "Shenzhen MobileGear", 14,
     [[("MRB", "Marble"), ("DSY", "Daisy"), ("BLK", "Black"), ("GLD", "Gold"), ("HOL", "Holographic"), ("SUN", "Sunset"), ("PAW", "Paw Print"), ("WAV", "Wave")]]),
    ("PW", "Portable Power Bank", 29.99, 0.36, "Phone accessories", "Shenzhen MobileGear", 21,
     [[("10K", "10000mAh"), ("20K", "20000mAh")], [("BLK", "Black"), ("WHT", "White"), ("BLU", "Blue")]]),
    ("WBD", "Silicone Smart Watch Band", 11.99, 0.14, "Phone accessories", "Shenzhen MobileGear", 14,
     [[("41", "38-41mm"), ("45", "42-45mm")], [("BLK", "Black"), ("WHT", "White"), ("NVY", "Navy"), ("PNK", "Pink"), ("OLV", "Olive"), ("RED", "Red"), ("LAV", "Lavender"), ("ORG", "Orange")]]),
    ("MG", "Ceramic Coffee Mug 12oz", 14.99, 0.25, "Kitchen", "Dehua Ceramics", 30,
     [[("SPK", "Speckled"), ("MBK", "Matte Black"), ("SGE", "Sage"), ("BLS", "Blush"), ("TER", "Terracotta"), ("CRM", "Cream"), ("NVY", "Navy"), ("MOS", "Moss"), ("SKY", "Sky Blue"), ("SND", "Sand")]]),
    ("UT", "Silicone Kitchen Utensil Set", 25.99, 0.27, "Kitchen", "Yongkang HomeWare", 25,
     [[("BLK", "Black"), ("GRY", "Grey"), ("SAG", "Sage"), ("KHK", "Khaki"), ("RED", "Red")]]),
    ("FB", "Reusable Silicone Food Bags", 19.99, 0.22, "Kitchen", "Yongkang HomeWare", 21,
     [[("4PK", "4 Pack"), ("8PK", "8 Pack"), ("12PK", "12 Pack")]]),
    ("AF", "Air Fryer Paper Liners", 9.99, 0.15, "Kitchen", "Yongkang HomeWare", 18,
     [[("6IN", "6.3in"), ("8IN", "7.9in"), ("9IN", "9in")], [("100", "100 Pack"), ("200", "200 Pack")]]),
    ("BS", "Microfiber Bed Sheet Set", 29.99, 0.27, "Home", "Shaoxing Textiles", 28,
     [[("TW", "Twin"), ("FL", "Full"), ("QN", "Queen"), ("KG", "King")], [("WHT", "White"), ("GRY", "Grey"), ("NVY", "Navy"), ("SGE", "Sage"), ("BLS", "Blush"), ("CHR", "Charcoal")]]),
    ("SC", "Waterproof Shower Curtain", 19.99, 0.22, "Home", "Shaoxing Textiles", 25,
     [[("BOT", "Botanical"), ("MRB", "Marble"), ("BOH", "Boho"), ("STR", "Stripe"), ("OCN", "Ocean"), ("GEO", "Geometric"), ("PLN", "Plain White"), ("CTY", "City")]]),
    ("CK", "Minimalist Wall Clock", 24.99, 0.29, "Home", "Zhongshan Lighting", 25,
     [[("10IN", "10in"), ("12IN", "12in")], [("BLK", "Black"), ("WOD", "Wood"), ("GLD", "Gold")]]),
    ("BL", "Knit Throw Blanket", 34.99, 0.31, "Home", "Shaoxing Textiles", 28,
     [[("50", "50x60in"), ("60", "60x80in")], [("CRM", "Cream"), ("GRY", "Grey"), ("SGE", "Sage"), ("MUS", "Mustard"), ("RST", "Rust"), ("NVY", "Navy")]]),
    ("PF", "Picture Frame", 12.99, 0.2, "Home", "Ningbo Paper", 25,
     [[("4X6", "4x6in"), ("5X7", "5x7in"), ("8X10", "8x10in"), ("11X14", "11x14in")], [("BLK", "Black"), ("WHT", "White"), ("OAK", "Oak")]]),
    ("BTM", "Memory Foam Bath Mat", 17.99, 0.24, "Home", "Shaoxing Textiles", 25,
     [[("GRY", "Grey"), ("WHT", "White"), ("NVY", "Navy"), ("SGE", "Sage"), ("BLS", "Blush"), ("CHR", "Charcoal")]]),
    ("ST", "Fabric Storage Bin", 13.99, 0.21, "Home", "Shaoxing Textiles", 25,
     [[("11", "11in Cube"), ("13", "13in Cube")], [("GRY", "Grey"), ("BEI", "Beige"), ("NVY", "Navy"), ("BLK", "Black"), ("SGE", "Sage"), ("WHT", "White")]]),
    ("CW", "Feather Wand Cat Toy", 8.99, 0.13, "Pet supplies", "Hangzhou PetCare", 18,
     [[("1PK", "Single"), ("3PK", "3 Pack"), ("5PK", "5 Pack")]]),
    ("CHW", "Durable Dog Chew Toy", 12.99, 0.18, "Pet supplies", "Hangzhou PetCare", 21,
     [[("S", "Small"), ("M", "Medium"), ("L", "Large")], [("BNE", "Bone"), ("RNG", "Ring"), ("STK", "Stick")]]),
    ("GB", "Pet Grooming Brush", 14.99, 0.17, "Pet supplies", "Hangzhou PetCare", 18,
     [[("SLK", "Slicker"), ("DSH", "Deshedding"), ("GLV", "Glove")]]),
    ("AB", "Running Phone Armband", 13.99, 0.16, "Fitness", "Xiamen FitPro", 18,
     [[("STD", "Standard"), ("XL", "XL")], [("BLK", "Black"), ("PNK", "Pink"), ("BLU", "Blue")]]),
    ("FR", "High Density Foam Roller", 21.99, 0.26, "Fitness", "Xiamen FitPro", 25,
     [[("12", "12in"), ("18", "18in"), ("24", "24in")], [("BLK", "Black"), ("BLU", "Blue")]]),
    ("JO", "Travel Jewelry Organizer", 16.99, 0.2, "Beauty", "Guangzhou BeautyLab", 21,
     [[("BLS", "Blush"), ("SGE", "Sage"), ("GRY", "Grey")]]),
    ("SK", "Bamboo Crew Socks 6-Pack", 18.99, 0.23, "Clothing", "Zhuji Hosiery", 28,
     [[("S", "Small"), ("M", "Medium"), ("L", "Large")], [("BLK", "Black"), ("WHT", "White"), ("MIX", "Mixed")]]),
    ("BN", "Cable Knit Beanie", 14.99, 0.18, "Clothing", "Zhuji Hosiery", 25,
     [[("BLK", "Black"), ("CRM", "Cream"), ("GRY", "Grey"), ("RST", "Rust"), ("OLV", "Olive"), ("NVY", "Navy"), ("PNK", "Pink"), ("MUS", "Mustard")]]),
    ("ER", "Gold Hoop Earrings Set", 15.99, 0.15, "Beauty", "Guangzhou BeautyLab", 18,
     [[("3PR", "3 Pairs"), ("5PR", "5 Pairs"), ("HUG", "Huggies"), ("CHN", "Chunky"), ("TWS", "Twisted"), ("PRL", "Pearl"), ("MIX", "Mixed"), ("MIN", "Mini")]]),
    ("SG", "Polarized Sunglasses", 19.99, 0.16, "Clothing", "Xiamen Optical", 25,
     [[("AVI", "Aviator"), ("RND", "Round"), ("SQR", "Square"), ("CAT", "Cat Eye")], [("BLK", "Black"), ("TRT", "Tortoise"), ("GLD", "Gold")]]),
    ("CO", "Car Seat Back Organizer", 18.99, 0.24, "Car", "Ningbo AutoParts", 25,
     [[("BLK", "Black"), ("GRY", "Grey"), ("BEI", "Beige")]]),
    ("TG", "Digital Tire Pressure Gauge", 12.99, 0.2, "Car", "Ningbo AutoParts", 21,
     [[("STD", "Standard"), ("LED", "With Light")]]),
]

_SIZE_WORD = re.compile(r"\d|^(XS|S|M|L|XL|Small|Medium|Large|Tall|Extra Large|Half Sheet|Quarter Sheet|Round 9in|Standard|Queen|King|Twin|Full|Single)$")

_PATTERNS = ["steady"] * 50 + ["rising"] * 10 + ["declining"] * 12 + ["seasonal"] * 8 + ["intermittent"] * 14 + ["new"] * 4 + ["viral"] * 2


def _big_store_products() -> tuple[SampleProduct, ...]:
    rng = random.Random("urban-nest")
    items = []
    for code, base, price, cost_share, category, supplier, lead, axes in _FAMILIES:
        combos: list[list[tuple[str, str]]] = [[]]
        for axis in axes:
            combos = [c + [v] for c in combos for v in axis]
        for combo in combos:
            sku = "-".join([code] + [v[0] for v in combo])
            name = f"{base} – {', '.join(v[1] for v in combo)}"
            # Bigger sizes or packs cost a little more (not colours or models); prices end in .99.
            step = axes[0].index(combo[0]) if _SIZE_WORD.search(axes[0][0][1]) else 0
            p = round(price * (1 + 0.07 * step)) - 0.01 if step else price
            items.append((sku, name, p, cost_share, category, supplier, lead))
    rng.shuffle(items)
    out = []
    for rank, (sku, name, price, cost_share, category, supplier, lead) in enumerate(items, start=1):
        # A few best sellers and a long tail (a Zipf-like curve), with some noise.
        weekly = round(26 * rank ** -0.85 * rng.uniform(0.7, 1.3), 2)
        pattern = rng.choice(_PATTERNS)
        if rng.random() < 0.04:
            pattern, weekly = "steady", 0.0  # listed but not selling: dead stock
        weeks_of_stock = rng.choice([0, 1, 2, 3, 4, 6, 8, 10, 12, 16, 20])
        stock = int(round(max(weekly, 0.4) * weeks_of_stock + rng.randint(0, 6)))
        growth = {"rising": 0.03, "declining": -0.03, "viral": 0.05}.get(pattern, 0.0)
        cost = round(price * cost_share * rng.uniform(0.9, 1.1), 2)
        item_id = str(296_000_000_000 + rank * 7_919)
        out.append(SampleProduct(sku, name, price, cost, weekly, growth, pattern, stock, lead, item_id, category, supplier))
    # Real shops have a few money problems; the profit leak finder should have something to find.
    for i in (11, 26, 44):  # bought too dear: every sale loses money after fees
        out[i] = replace(out[i], cost=round(out[i].price * 0.93, 2), pattern="steady")
    for i in (17, 33, 58):  # thin margins: about 5–8% left after fees
        out[i] = replace(out[i], cost=round(out[i].price * 0.78, 2), pattern="steady")
    for i in (6, 21):  # a discount that was never switched off
        out[i] = replace(out[i], slip=0.2, pattern="steady")
    return tuple(out)


STORES["bigstore"] = SampleStore(
    "bigstore", "ebay", "Big eBay store (550 products)", "Urban Nest Home & Tech (sample)", "home, kitchen, phone accessories and pet supplies",
    "urban-nest-ebay-orders-sample.csv", _big_store_products(),
)


def _poisson(rng: random.Random, lam: float) -> int:
    if lam <= 0:
        return 0
    limit, k, p = math.exp(-lam), 0, 1.0
    while True:
        p *= rng.random()
        if p <= limit:
            return k
        k += 1


def _daily_rate(p: SampleProduct, week_idx: float, weeks: int, day: datetime, rng: random.Random) -> float:
    rate = p.weekly / 7 * (1 + p.growth) ** (week_idx - weeks)  # base is "about now"
    if p.pattern == "viral":
        rate *= 0.45 + 1.4 / (1 + math.exp(-(week_idx - (weeks - 5))))
    elif p.pattern == "seasonal":
        rate *= 1 + 0.6 * math.cos((day.timetuple().tm_yday - 350) / 365 * 2 * math.pi)
    elif p.pattern == "new" and week_idx < weeks - 6:
        rate = 0
    elif p.pattern == "intermittent":
        rate = rate * 3.5 if rng.random() < 0.28 else 0
    if day.weekday() >= 5:
        rate *= 1.2
    return rate


@dataclass
class SimSale:
    product: SampleProduct
    when: datetime
    qty: int
    price: float
    order: int
    cancelled: bool


# (product index, often bought with product index, chance per order)
COMPANIONS: dict[str, list[tuple[int, int, float]]] = {
    "ebay": [(0, 1, 0.6)],          # console + controller
    "amazon": [(1, 2, 0.4)],        # spiralizer + oil sprayer
    "shopify": [(3, 0, 0.6)],       # yoga mat + resistance bands
    "etsy": [(0, 1, 0.6)],          # initial necklace + huggie hoops
    "tiktok": [(2, 0, 0.5)],        # skin scrubber + ice roller
}


def simulate(store: SampleStore, weeks: int = 26, now: datetime | None = None, seed: int = 11) -> list[SimSale]:
    """Order lines for the store, oldest first, ending yesterday."""
    rng = random.Random(f"{store.key}-{seed}")
    now = (now or datetime.now(timezone.utc)).replace(microsecond=0)
    end = now.replace(hour=0, minute=0, second=0)
    sales: list[SimSale] = []
    order_no = 1001
    for d in range(weeks * 7, 0, -1):
        day = end - timedelta(days=d)
        week_idx = weeks - d / 7
        for p in store.products:
            n = _poisson(rng, _daily_rate(p, week_idx, weeks, day, rng))
            for _ in range(n):
                qty = 2 if rng.random() < 0.08 else 1
                when = day + timedelta(seconds=rng.randint(7 * 3600, 23 * 3600))
                price = round(p.price * (0.9 if rng.random() < 0.12 else 1.0), 2)
                if p.slip and d <= 30:
                    price = round(p.price * (1 - p.slip), 2)
                sales.append(SimSale(p, when, qty, price, 0, rng.random() < 0.025))
    sales.sort(key=lambda s: s.when)
    # Group some lines into multi-item orders.
    i = 0
    while i < len(sales):
        sales[i].order = order_no
        if i + 1 < len(sales) and rng.random() < 0.12 and (sales[i + 1].when - sales[i].when).seconds < 7200:
            sales[i + 1].order = order_no
            sales[i + 1].when = sales[i].when
            i += 1
        order_no += 1
        i += 1
    # Products customers often buy together (so the "Bought together" insight has something real to find).
    extra = [
        SimSale(store.products[b], s.when, 1, store.products[b].price, s.order, s.cancelled)
        for a, b, prob in COMPANIONS.get(store.key, [])
        for s in sales
        if s.product is store.products[a] and rng.random() < prob
    ]
    return sorted(sales + extra, key=lambda s: s.when)


def _csv(rows: list[list[str]], delimiter: str = ",") -> str:
    buf = io.StringIO()
    csv.writer(buf, delimiter=delimiter, lineterminator="\n").writerows(rows)
    return buf.getvalue()


FIRST = ["alex", "sam", "jordan", "casey", "taylor", "morgan", "jamie", "riley", "drew", "quinn"]


def _buyer(rng: random.Random) -> str:
    return f"{rng.choice(FIRST)}_{rng.randint(100, 9999)}"


def ebay_orders(store: SampleStore, sales: list[SimSale]) -> str:
    rng = random.Random("ebay-buyers")
    header = [
        "Sales Record Number", "Order Number", "Buyer Username", "Buyer Name", "Ship To City", "Ship To Country",
        "Item Number", "Item Title", "Custom Label", "Quantity", "Sold For", "Postage And Packaging",
        "Total Price", "Sale Date", "Paid On Date",
    ]
    rows: list[list[str]] = [[], header]
    for n, s in enumerate(reversed(sales), start=1):
        if s.cancelled:
            continue  # eBay leaves cancelled orders out of the default report
        buyer = _buyer(rng)
        rows.append([
            str(9000 + len(sales) - n), f"0{s.order}-2{s.order:05d}-{s.order % 97:05d}", buyer, "Sample Buyer",
            "Springfield", "United States", s.product.item_id, s.product.name, s.product.sku, str(s.qty),
            f"${s.price:.2f}", "$0.00", f"${s.price * s.qty:.2f}", s.when.strftime("%b-%d-%y"), s.when.strftime("%b-%d-%y"),
        ])
    seller = store.store_name.split(" (")[0].lower().replace(" & ", "_").replace(" ", "")
    rows += [[], [f"{len(rows) - 2} record(s) downloaded"], [f"Seller ID : {seller}_sample"]]
    return _csv(rows)


def amazon_orders(store: SampleStore, sales: list[SimSale]) -> str:
    header = [
        "amazon-order-id", "merchant-order-id", "purchase-date", "last-updated-date", "order-status",
        "fulfillment-channel", "sales-channel", "product-name", "sku", "asin", "item-status", "quantity",
        "currency", "item-price", "item-tax", "shipping-price",
    ]
    rows = [header]
    for s in reversed(sales):
        status = "Cancelled" if s.cancelled else "Shipped"
        oid = f"111-{s.order:07d}-{(s.order * 7919) % 10_000_000:07d}"
        rows.append([
            oid, "", s.when.strftime("%Y-%m-%dT%H:%M:%S+00:00"), (s.when + timedelta(days=2)).strftime("%Y-%m-%dT%H:%M:%S+00:00"),
            status, "Amazon", "Amazon.com", s.product.name, s.product.sku, s.product.item_id,
            "Cancelled" if s.cancelled else "Shipped", str(s.qty), "USD", f"{s.price * s.qty:.2f}", "0.00", "0.00",
        ])
    return _csv(rows, delimiter="\t")


def shopify_orders(store: SampleStore, sales: list[SimSale]) -> str:
    header = [
        "Name", "Email", "Financial Status", "Paid at", "Fulfillment Status", "Currency", "Subtotal", "Total",
        "Created at", "Lineitem quantity", "Lineitem name", "Lineitem price", "Lineitem sku", "Vendor", "Cancelled at", "Source",
    ]
    rows = [header]
    by_order: dict[int, list[SimSale]] = {}
    for s in sales:
        by_order.setdefault(s.order, []).append(s)
    rng = random.Random("shopify")
    for order, lines in sorted(by_order.items(), reverse=True):
        first = lines[0]
        subtotal = sum(line.price * line.qty for line in lines)
        stamp = first.when.strftime("%Y-%m-%d %H:%M:%S +0000")
        cancelled = any(line.cancelled for line in lines)
        source = rng.choice(["web", "web", "web", "shop_app", "instagram"])
        for j, line in enumerate(lines):
            if j == 0:
                rows.append([
                    f"#{order}", f"customer{order}@example.com", "refunded" if cancelled else "paid", stamp,
                    "" if cancelled else "fulfilled", "USD", f"{subtotal:.2f}", f"{subtotal:.2f}", stamp,
                    str(line.qty), line.product.name, f"{line.price:.2f}", line.product.sku, "Iron & Oak",
                    stamp if cancelled else "", source,
                ])
            else:  # Shopify only fills order-level columns on an order's first row
                rows.append([f"#{order}", f"customer{order}@example.com", "", "", "", "", "", "", "",
                             str(line.qty), line.product.name, f"{line.price:.2f}", line.product.sku, "Iron & Oak", "", ""])
    return _csv(rows)


def shopify_products(store: SampleStore) -> str:
    header = ["Handle", "Title", "Vendor", "Type", "Variant SKU", "Variant Inventory Qty", "Variant Price", "Cost per item", "Status"]
    rows = [header]
    for p in store.products:
        rows.append([p.sku.lower(), p.name, "Iron & Oak", "Fitness", p.sku, str(p.stock), f"{p.price:.2f}", f"{p.cost:.2f}", "active"])
    return _csv(rows)


def etsy_order_items(store: SampleStore, sales: list[SimSale]) -> str:
    header = [
        "Sale Date", "Item Name", "Buyer", "Quantity", "Price", "Coupon Code", "Discount Amount", "Order Shipping",
        "Item Total", "Currency", "Transaction ID", "Listing ID", "Date Paid", "Order ID", "SKU",
    ]
    rows = [header]
    rng = random.Random("etsy")
    for s in reversed(sales):
        if s.cancelled:
            continue
        rows.append([
            s.when.strftime("%m/%d/%y"), s.product.name, _buyer(rng), str(s.qty), f"{s.product.price:.2f}", "", "0",
            "4.50", f"{s.price * s.qty:.2f}", "USD", str(3_100_000_000 + s.order * 3), s.product.item_id,
            s.when.strftime("%m/%d/%y"), str(2_900_000_000 + s.order), s.product.sku,
        ])
    return _csv(rows)


def tiktok_orders(store: SampleStore, sales: list[SimSale]) -> str:
    header = [
        "Order ID", "Order Status", "SKU ID", "Seller SKU", "Product Name", "Variation", "Quantity",
        "SKU Unit Original Price", "SKU Subtotal After Discount", "Created Time", "Paid Time",
    ]
    rows = [header]
    for s in reversed(sales):
        oid = str(576_000_000_000_000_000 + s.order * 1_234_567)
        stamp = s.when.strftime("%m/%d/%Y %I:%M:%S %p")
        rows.append([
            oid, "Canceled" if s.cancelled else "Completed", s.product.item_id, s.product.sku, s.product.name, "Default",
            str(s.qty), f"{s.product.price:.2f}", f"{s.price * s.qty:.2f}", stamp, stamp,
        ])
    return _csv(rows)


def spreadsheet_xlsx(store: SampleStore, sales: list[SimSale]) -> bytes:
    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.title = "Sales"
    ws.append(["My sales log (sample data)"])
    ws.append([])
    ws.append(["Date", "Product", "Qty", "Price"])
    for s in sales:
        if not s.cancelled:
            ws.append([s.when.replace(tzinfo=None), s.product.name, s.qty, s.price])
    st = wb.create_sheet("Stock")
    st.append(["Product", "SKU", "In stock", "Cost", "Price", "Supplier", "Supplier days"])
    for i, p in enumerate(store.products):
        st.append([p.name, p.sku, p.stock, p.cost, p.price, supplier_for(store.key, i), p.lead_days])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def build(key: str, now: datetime | None = None) -> tuple[str, bytes]:
    """Return (filename, file bytes) for a sample store."""
    if key == "shopify-products":
        return "shopify-products-sample.csv", shopify_products(STORES["shopify"]).encode()
    store = STORES[key]
    sales = simulate(store, now=now)
    if key in ("ebay", "bigstore"):
        return store.filename, ebay_orders(store, sales).encode()
    if key == "amazon":
        return store.filename, amazon_orders(store, sales).encode()
    if key == "shopify":
        return store.filename, shopify_orders(store, sales).encode()
    if key == "etsy":
        return store.filename, etsy_order_items(store, sales).encode()
    if key == "tiktok":
        return store.filename, tiktok_orders(store, sales).encode()
    if key == "spreadsheet":
        return store.filename, spreadsheet_xlsx(store, sales)
    raise KeyError(key)


# Made-up suppliers for the sample stock lists, so supplier orders have something to group by.
SUPPLIERS = {
    "ebay": ["Shenzhen RetroTech", "GameParts Wholesale"],
    "amazon": ["Yiwu KitchenPro", "HomeChef Supply"],
    "etsy": ["Silver Lane Findings", "Gemstone Direct"],
    "tiktok": ["GlowSource Beauty", "Guangzhou SkinTech"],
    "spreadsheet": ["EcoPet Supply", "Green Paws Trading"],
}


def supplier_for(key: str, i: int) -> str:
    names = SUPPLIERS.get(key, [""])
    return names[i % len(names)]


def stock_csv(key: str) -> tuple[str, bytes]:
    """A simple stock list for any sample store (sellers can also type stock in the app)."""
    store = STORES[key]
    rows = [["SKU", "Product", "Category", "Stock", "Cost", "Price", "Supplier", "Supplier days"]]
    for i, p in enumerate(store.products):
        sku = p.sku or ("EBAY-" + p.item_id if store.platform == "ebay" and p.item_id else "")
        rows.append([sku, p.name, p.category, str(p.stock), f"{p.cost:.2f}", f"{p.price:.2f}", p.supplier or supplier_for(key, i), str(p.lead_days)])
    return f"{key}-stock-sample.csv", _csv(rows).encode()

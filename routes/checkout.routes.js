const router = require("express").Router();
const seatsDefault = require("../config/seatsDefault");
const timesDefault = require("../config/timesDefault");

const User = require("../models/User.model");
const Movie = require("../models/Movie.model");
const Venue = require("../models/Venue.model");
const Showtime = require("../models/Showtime.model");
const Ticket = require("../models/Ticket.model");
const mongoose = require("mongoose");
const stripe = require("stripe")(process.env.STRIPE_KEY);
var url = require("url");
const isLoggedIn = require("../middleware/isLoggedIn");
const isLoggedOut = require("../middleware/isLoggedOut");
const path = require("path");
const { redirect } = require("express/lib/response");
const { log } = require("console");
const saltRounds = 10;

router.post("/process", async (req, res, next) => {
  if (req.session.user.tempSeats.length > 0) {
    let mypath = req.get("host");
    const sessi = await stripe.checkout.sessions
      .create({
        mode: "payment",
        success_url: `http://${mypath}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `http://${mypath}/checkout/summary`,
        payment_method_types: ["card"],
        line_items: [
          {
            price: "price_1KG7HyDpYP7j5IOA6q1gE5P3",
            quantity: req.session.user.tempSeats.length,
          },
        ],
      })
      .then((result) => {
        res.redirect(result.url);
      });
  }
});

router.put("/pre-summary", isLoggedIn, (req, res, next) => {
  if (typeof req.body.selectedSeats === "string") {
    req.session.user.tempSeats = [req.body.selectedSeats];
  } else {
    req.session.user.tempSeats = req.body.selectedSeats;
  }
  res.json("");
});

router.post("/pre-summary", isLoggedIn, (req, res, next) => {
  if (typeof req.body.seats === "string") {
    req.session.user.tempSeats = [req.body.seats];
  } else {
    req.session.user.tempSeats = req.body.seats;
  }
  res.redirect("summary");
});

router.get("/summary", isLoggedIn, (req, res, next) => {
  console.log("TEMP SEATS", req.session.user.tempSeats);
  Ticket.find({ _id: { $in: req.session.user.tempSeats } })
    .populate("venue")
    .populate("movie")

    .then((tickets) => {
      let price = tickets.length * 20;
      res.render("checkout/summary", { tickets, price });
    })
    .catch((err) => {
      next(err);
    });
});

router.get("/success", isLoggedIn, async (req, res, next) => {
  if (req.session.user.tempSeats.length > 0) {
    User.findByIdAndUpdate(
      req.session.user._id,
      {
        $push: { tickets: req.session.user.tempSeats },
      },
      { new: true }
    )
      .then((updatedUser) => {
        Ticket.update(
          { _id: { $in: req.session.user.tempSeats } },
          {
            $set: {
              user: req.session.user._id,
              occupied: true,
              paymentId: req.query.session_id,
            },
          },
          { multi: true }
        )

          .then((updatedTickets) => {
            req.session.user.tempSeats = [];
            console.log({ updatedTickets });
            req.session.user = updatedUser;
            res.render("checkout/success");
          })
          .catch((err) => next(err));
      })
      .catch((err) => next(err));
  } else {
    res.redirect("/");
  }
});

router.get("/refund/:seatId", isLoggedIn, (req, res, next) => {
  let refundStatus = "";
  Ticket.findById(req.params.seatId)
    .then(async (ticket) => {
      console.log("FOUND TICKET", ticket);

      const session = await stripe.checkout.sessions.retrieve(ticket.paymentId);
      const refund = await stripe.refunds
        .create({
          payment_intent: session.payment_intent,
          amount: 2000,
        })
        .then((result) => {
          console.log("RESULT", result);
          refundStatus = result.status;
        })
        .catch((err) => next(err));

      console.log("REFUND STATUS", refund);

      if (refundStatus === "succeeded") {
        Ticket.findByIdAndUpdate(req.params.seatId, {
          occupied: false,
          paymentId: "",
        }).then((result) => {
          User.updateOne(
            { username: req.session.user.username },
            {
              $pullAll: {
                tickets: [req.params.seatId],
              },
            }
          )
            .then((result2) => {
              User.updateOne(
                { username: req.session.user.username },
                {
                  $push: {
                    refundedTickets: ticket._id,
                  },
                }
              )
                .then((result3) => {
                  console.log("test succes");
                  res.redirect("/user/tickets");
                })
                .catch((err) => next(err));
            })
            .catch((err) => next(err));
        });
      }
    })
    .catch((err) => next(err));
  //
});

module.exports = router;

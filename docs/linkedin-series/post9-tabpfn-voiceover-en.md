# Post 9 – Voiceover (EN)

Voice: Isla (British female, calm). Music: original swing in the style of a rain-dance musical, with rain. Sample data; design study, not an SAP product.

## Forecast with TabPFN

Hello, I am Isla, Design Engineer! Design Study twenty twenty-six: forecasts with TabPFN, a tabular foundation model, shown on the late-payment forecast.
These are possible design proposals within an MVP. Sample data, not a finished product.

## One question per customer

In the Sales Space there is a Late payments tab. The question: which open invoices will probably be paid more than fourteen days after the due date?
You pick a customer and press Run forecast. Nothing is sent, and nothing is changed.

## Open invoices, ranked by risk

Here are the open invoices of one customer, the most likely late one first. One is already late, so there is nothing left to predict. The next one has an eighty-two percent chance, and the third is on watch at fifty-seven.
So you know where to send the first reminder.

## Every score says why

Every score comes with its three strongest drivers, and how many points each one moves it. The usual delay of this customer adds thirty-one points. A large amount adds fourteen.
A forecast you can question, not a black box.

## Another customer, another picture

Switch the customer, and the picture changes. This one usually pays two days early, so both invoices score low, even though one of them is large.

## The same method in Controlling

The same service also serves two Controlling forecasts. The month-end spend per cost group, with an eighty percent band. And the accrual proposals in the Pre-Close: an interval for the final amount, and the chance that it is off by more than ten percent.
A person still approves every accrual.

## Good to know

One honest note. The model is trained on synthetic invoice history, and the figures here are sample data. The footer always says which engine answered: TabPFN, or a labelled baseline if the model is not loaded.
It demonstrates the method. It is not a credit assessment.

## Closing

Know which invoices will be late, and why. A person decides.

---
Note: the service falls back to a labelled baseline if TabPFN weights are not loaded; check the TabPFN licence before any public or customer use.
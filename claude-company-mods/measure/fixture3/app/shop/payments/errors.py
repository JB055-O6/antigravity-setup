"""Payment failures. Callers catch PaymentError."""


class PaymentError(Exception):
    pass


class PaymentDeclined(PaymentError):
    pass


class PaymentGatewayTimeout(PaymentError):
    pass


class CircuitOpen(PaymentError):
    pass

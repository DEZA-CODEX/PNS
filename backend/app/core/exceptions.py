class APIError(Exception):
    def __init__(self, code: str, message: str, status_code: int) -> None:
        super().__init__(message)
        self.code = code
        self.status_code = status_code


class AdminAuthError(APIError):
    pass


class ServiceUnavailableError(APIError):
    def __init__(self, message: str) -> None:
        super().__init__("service_unavailable", message, 503)


class ImageManagementError(APIError):
    pass

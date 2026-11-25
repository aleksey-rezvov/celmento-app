from typing import Annotated

from fastapi import APIRouter, Body, File, Query, Request

from celmento_api.auth import Database, SignedInAccount
from celmento_api.errors import error_responses
from celmento_api.schemas.account import Account as AccountView
from celmento_api.schemas.account import AccountUpdate, ProfilePhotoUpload
from celmento_api.schemas.auth import AccountActivation, LoginAvailability
from celmento_api.services.accounts import account_view, lock_account, update_account
from celmento_api.services.activation import activate
from celmento_api.services.logins import login_status
from celmento_api.storage import discard_photo, media_origin, save_photo

router: APIRouter = APIRouter(prefix="/account", tags=["account"])


@router.get(
    "",
    operation_id="getAccount",
    summary="Get the signed-in account",
    response_model=AccountView,
    responses=error_responses(401, 500),
)
async def get_account(
    request: Request, account: SignedInAccount, session: Database
) -> AccountView:
    # spec:impl account-profile#keep-account-signed-app-launches
    return await account_view(session, account, media_origin(request))


@router.patch(
    "",
    operation_id="updateAccount",
    summary="Update the account profile and settings",
    response_model=AccountView,
    responses=error_responses(400, 401, 403, 409, 422, 500),
)
async def patch_account(
    request: Request,
    body: Annotated[AccountUpdate, Body()],
    account: SignedInAccount,
    session: Database,
) -> AccountView:
    account = await lock_account(session, account.account_id)
    await update_account(session, account, body.root)
    result = await account_view(session, account, media_origin(request))
    await session.commit()
    return result


@router.post(
    "/activation",
    operation_id="activateAccount",
    summary="Turn on client leading for the account",
    response_model=AccountView,
    responses=error_responses(400, 401, 409, 422, 500),
)
async def activate_account(
    request: Request,
    body: AccountActivation,
    account: SignedInAccount,
    session: Database,
) -> AccountView:
    account = await activate(session, account, body)
    result = await account_view(session, account, media_origin(request))
    await session.commit()
    return result


@router.get(
    "/login-availability",
    operation_id="checkLoginAvailability",
    summary="Check a login as it is typed",
    response_model=LoginAvailability,
    responses=error_responses(401, 422, 500),
)
async def check_login_availability(
    login: Annotated[str, Query()],
    account: SignedInAccount,
    session: Database,
) -> LoginAvailability:
    # spec:impl booking-link-login#check-login-typed-show-field
    return LoginAvailability(
        login=login.lower(),
        status=await login_status(session, login, account.account_id),
    )


@router.put(
    "/photo",
    operation_id="uploadAccountPhoto",
    summary="Set the account photo",
    response_model=AccountView,
    responses=error_responses(401, 422, 500),
)
async def upload_account_photo(
    request: Request,
    body: Annotated[ProfilePhotoUpload, File()],
    account: SignedInAccount,
    session: Database,
) -> AccountView:
    account = await lock_account(session, account.account_id)
    previous_key = account.photo_key
    key = await save_photo(body.file)
    try:
        # spec:impl account-profile#let-account-add-photo-gallery
        account.photo_key = key
        result = await account_view(session, account, media_origin(request))
    except BaseException:
        await discard_photo(key)
        raise
    # A failed commit can have an unknown outcome, so keep the candidate file.
    await session.commit()
    await discard_photo(previous_key)
    return result


@router.delete(
    "/photo",
    operation_id="deleteAccountPhoto",
    summary="Remove the account photo",
    response_model=AccountView,
    responses=error_responses(401, 500),
)
async def delete_account_photo(
    request: Request, account: SignedInAccount, session: Database
) -> AccountView:
    account = await lock_account(session, account.account_id)
    previous_key = account.photo_key
    account.photo_key = None
    result = await account_view(session, account, media_origin(request))
    await session.commit()
    await discard_photo(previous_key)
    return result

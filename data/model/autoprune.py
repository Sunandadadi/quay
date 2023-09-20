import json
import datetime
import logging.config
from data.database import (
    AutoPruneTaskStatus,
    NamespaceAutoPrunePolicy as NamespaceAutoPrunePolicyTable,
    User,
    Repository,
    RepositoryState,
    DeletedNamespace,
    get_epoch_timestamp_ms,
)
from data.model import db_transaction, modelutil, oci
from enum import Enum

from util.timedeltastring import convert_to_timedelta

logger = logging.getLogger(__name__)
PAGINATE_SIZE = 50


class AutoPruneMethod(Enum):
    NUMBER_OF_TAGS = "number_of_tags"
    CREATION_DATE = "creation_date"


class NamespaceAutoPrunePolicy:
    def __init__(self, db_row):
        config = json.loads(db_row.policy)
        self._db_row = db_row
        self.uuid = db_row.uuid
        self.method = config.get("method")
        self.config = config

    def get_row(self):
        return self._db_row

    def get_view(self):
        return {"uuid": self.uuid, "method": self.method, "value": self.config.get("value")}


def valid_value(method, value):
    if method == AutoPruneMethod.NUMBER_OF_TAGS and not isinstance(value, int):
        return False
    elif method == AutoPruneMethod.CREATION_DATE:
        if not isinstance(value, str):
            return False

        try:
            convert_to_timedelta(value)
        except ValueError:
            return False

    return True


def get_namespace_autoprune_policies_by_orgname(orgname):
    """
    Get the autopruning policies for the specified namespace.
    """
    try:
        query = (
            NamespaceAutoPrunePolicyTable.select(NamespaceAutoPrunePolicyTable)
            .join(User)
            .where(
                User.username == orgname,
            )
        )
        return [NamespaceAutoPrunePolicy(row) for row in query]
    except NamespaceAutoPrunePolicyTable.DoesNotExist:
        return []


def get_namespace_autoprune_policies_by_id(namespace_id):
    """
    Get the autopruning policies for the namespace by id.
    """
    try:
        query = NamespaceAutoPrunePolicyTable.select().where(
            NamespaceAutoPrunePolicyTable.namespace == namespace_id,
        )
        return [NamespaceAutoPrunePolicy(row) for row in query]
    except NamespaceAutoPrunePolicyTable.DoesNotExist:
        return []


def get_namespace_autoprune_policy(orgname, uuid):
    try:
        row = (
            NamespaceAutoPrunePolicyTable.select(NamespaceAutoPrunePolicyTable)
            .join(User)
            .where(NamespaceAutoPrunePolicyTable.uuid == uuid, User.username == orgname)
            .get()
        )
        return NamespaceAutoPrunePolicy(row)
    except NamespaceAutoPrunePolicyTable.DoesNotExist:
        return None


def create_namespace_autoprune_policy(orgname, policy_config, create_task=False):
    with db_transaction():
        try:
            namespace_id = User.select().where(User.username == orgname).get().id
        except User.DoesNotExist:
            pass
            # TODO: throw unknown user error

        if namespace_has_autoprune_policy(namespace_id):
            # TODO: throw namespace already has policy error
            return

        new_policy = NamespaceAutoPrunePolicyTable.create(
            namespace=namespace_id, policy=json.dumps(policy_config)
        )

        # Add task if it doesn't already exist
        if create_task and not namespace_has_autoprune_task(namespace_id):
            AutoPruneTaskStatus.create(namespace=namespace_id, status="queued", last_ran_ms=None)

        return new_policy


def update_namespace_autoprune_policy(orgname, uuid, policy_config):
    policy = get_namespace_autoprune_policy(orgname, uuid)
    if policy is None:
        # TODO: throw 404 here
        return None

    try:
        namespace_id = User.select().where(User.username == orgname).get().id
    except User.DoesNotExist:
        pass
        # TODO: throw unknown user error

    (
        NamespaceAutoPrunePolicyTable.update(policy=json.dumps(policy_config))
        .where(
            NamespaceAutoPrunePolicyTable.uuid == uuid,
            NamespaceAutoPrunePolicyTable.namespace == namespace_id,
        )
        .execute()
    )
    return True


def delete_namespace_autoprune_policy(orgname, uuid):
    with db_transaction():
        try:
            namespace_id = User.select().where(User.username == orgname).get().id
        except User.DoesNotExist:
            pass
            # TODO: throw unknown user error

        try:
            (
                NamespaceAutoPrunePolicyTable.delete()
                .where(
                    NamespaceAutoPrunePolicyTable.uuid == uuid,
                    NamespaceAutoPrunePolicyTable.namespace == namespace_id,
                )
                .execute()
            )
            return True
        except NamespaceAutoPrunePolicyTable.DoesNotExist:
            return None


def namespace_has_autoprune_policy(namespace_id):
    return (
        NamespaceAutoPrunePolicyTable.select(1)
        .where(NamespaceAutoPrunePolicyTable.namespace == namespace_id)
        .exists()
    )


def namespace_has_autoprune_task(namespace_id):
    return (
        AutoPruneTaskStatus.select(1).where(AutoPruneTaskStatus.namespace == namespace_id).exists()
    )


def update_autoprune_task(task, task_status):
    AutoPruneTaskStatus.update(status=task_status, last_ran_ms=get_epoch_timestamp_ms()).where(
        AutoPruneTaskStatus.id == task.id
    ).execute()


def fetch_ordered_autoprune_tasks_for_batchsize(batch_size):
    """
    Get the auto prune task prioritized by last_ran_ms = None followed by asc order of last_ran_ms
    """
    with db_transaction():
        try:
            # TODO: Can reuse exisiting db_for_update for create a new db_object for 
            # `for update skip locked` to account for different drivers
            query = (
                AutoPruneTaskStatus.select()
                .where(
                    AutoPruneTaskStatus.namespace.not_in(
                        DeletedNamespace.select(DeletedNamespace.namespace)
                    )
                )
                .order_by(AutoPruneTaskStatus.last_ran_ms.asc(nulls="first"), AutoPruneTaskStatus.id)
                .limit(batch_size)
                .for_update("FOR UPDATE SKIP LOCKED")
            )
            return [row for row in query]
        except AutoPruneTaskStatus.DoesNotExist:
            return []


def fetch_batched_autoprune_tasks(batch_size):
    batched_tasks = fetch_ordered_autoprune_tasks_for_batchsize(batch_size)
    if not len(batched_tasks):
        return None
    return batched_tasks


def delete_autoprune_task(task):
    with db_transaction():
        try:
            (
                AutoPruneTaskStatus.delete()
                .where(
                    AutoPruneTaskStatus.id == task.id,
                    AutoPruneTaskStatus.namespace_id == task.namespace_id,
                )
                .execute()
            )
            return True
        except AutoPruneTaskStatus.DoesNotExist:
            return None


def prune_repo_by_number_of_tags(repo_id, policy_config):
    logger.info(
        f"Executing prune_repo_by_number_of_tags for repo: {repo_id} with policy config: {policy_config}"
    )
    policy_method = policy_config.get("method", None)

    if policy_method != AutoPruneMethod.NUMBER_OF_TAGS.value or not valid_value(
        AutoPruneMethod(policy_method), policy_config.get("value")
    ):
        raise KeyError("Unsupported policy config provided", policy_config)

    page_token = None
    while True:
        tags, page_token = oci.tag.fetch_paginated_autoprune_repo_tags_by_number(
            repo_id, int(policy_config["value"]), page_token, PAGINATE_SIZE
        )
        tags_list = [row for row in tags]

        for tag in tags_list:
            # TODO: Replace with audit logs here
            logger.info(f"Deleting tag: {tag.name} from repo_id: {repo_id}")
            oci.tag.delete_tag(repo_id, tag.name)

        if page_token is None:
            break


def prune_repo_by_creation_date(repo_id, policy_config):
    logger.info(
        f"Executing prune_repo_by_creation_date for repo: {repo_id} with policy config: {policy_config}"
    )
    policy_method = policy_config.get("method", None)

    if policy_method != AutoPruneMethod.CREATION_DATE.value or not valid_value(
        AutoPruneMethod(policy_method), policy_config.get("value")
    ):
        raise KeyError("Unsupported policy config provided", policy_config)

    time_ms = int(convert_to_timedelta(policy_config["value"]).total_seconds() * 1000)

    page_token = None
    while True:
        tags, page_token = oci.tag.fetch_paginated_autoprune_repo_tags_older_than_ms(
            repo_id, time_ms, page_token, PAGINATE_SIZE
        )
        tags_list = [row for row in tags]

        for tag in tags_list:
            # TODO: Replace with audit logs here
            logger.info(f"Deleting tag: {tag.name} from repo_id: {repo_id}")
            oci.tag.delete_tag(repo_id, tag.name)

        if page_token is None:
            break


def execute_poilcy_on_repo(policy, repo):
    policy_to_func_map = {
        AutoPruneMethod.NUMBER_OF_TAGS.value: prune_repo_by_number_of_tags,
        AutoPruneMethod.CREATION_DATE.value: prune_repo_by_creation_date,
    }

    if policy_to_func_map.get(policy.method, None) is None:
        raise KeyError("Unsupported policy provided", policy.method)

    policy_to_func_map[policy.method](repo, policy.config)


def execute_policies_for_repo(policies, repo):
    list(map(lambda policy: execute_poilcy_on_repo(policy, repo), policies))


def get_paginated_repositories_for_namespace(namespace_id, page_token=None):
    query = Repository.select(
        Repository.name,
        Repository.id,
        Repository.visibility,
        Repository.kind,
        Repository.state,
    ).where(
        Repository.state != RepositoryState.MARKED_FOR_DELETION,
        Repository.namespace_user == namespace_id,
    )
    repos, next_page_token = modelutil.paginate(
        query,
        Repository,
        page_token=page_token,
        limit=PAGINATE_SIZE,
    )
    return repos, next_page_token


def execute_namespace_polices(policies, namespace_id):
    if not policies:
        return
    page_token = None

    while True:
        repos, page_token = get_paginated_repositories_for_namespace(namespace_id, page_token)
        repo_list = [row for row in repos]

        # When implementing repo policies, fetch repo policies and add it to the policies list here
        list(map(lambda repo: execute_policies_for_repo(policies, repo), repo_list))

        if page_token is None:
            break
